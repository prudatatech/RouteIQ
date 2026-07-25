import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.models import Shipment, Parcel, DeliveryPoint, ShipmentLog
from app.schemas.schemas import ShipmentCreate
from app.services.security_service import SecurityService

class ShipmentService:
    @staticmethod
    async def record_shipment_log(db: AsyncSession, shipment_id: uuid.UUID, status: str, lat: float = None, lng: float = None, metadata: dict = None) -> ShipmentLog:
        """
        Records a tamper-evident log for a shipment status change.
        """
        # 1. Fetch the last log to get previous hash and index
        result = await db.execute(
            select(ShipmentLog)
            .where(ShipmentLog.shipment_id == shipment_id)
            .order_by(ShipmentLog.index.desc())
            .limit(1)
        )
        last_log = result.scalar_one_or_none()
        
        prev_hash = last_log.log_hash if last_log else "0" * 64
        new_index = (last_log.index + 1) if last_log else 0
        
        # 2. Prepare data for hashing
        timestamp = datetime.now()
        data = {
            "shipment_id": str(shipment_id),
            "status": status,
            "location_lat": lat,
            "location_lng": lng,
            "timestamp": timestamp.isoformat(),
            "index": new_index,
            "metadata": metadata or {}
        }
        
        # 3. Generate hash
        new_hash = SecurityService.generate_hash(data, prev_hash)
        
        # 4. Create and save log
        db_log = ShipmentLog(
            shipment_id=shipment_id,
            status=status,
            location_lat=lat,
            location_lng=lng,
            timestamp=timestamp,
            index=new_index,
            previous_hash=prev_hash,
            log_hash=new_hash,
            metadata_json=metadata or {}
        )
        db.add(db_log)
        await db.flush()
        return db_log

    @staticmethod
    async def create_shipment(db: AsyncSession, shipment_in: ShipmentCreate) -> Shipment:
        # Generate tracking ID if not provided
        tracking_id = shipment_in.tracking_id or f"RTX-{uuid.uuid4().hex[:8].upper()}"
        
        db_shipment = Shipment(
            tracking_id=tracking_id,
            priority=shipment_in.priority,
            status="created",
            origin_name=shipment_in.origin_name,
            origin_address=shipment_in.origin_address,
            origin_lat=shipment_in.origin_lat,
            origin_lng=shipment_in.origin_lng,
            total_items=shipment_in.total_items,
            total_weight_kg=shipment_in.total_weight_kg
        )
        db.add(db_shipment)
        await db.flush()  # Get ID
        
        total_weight = 0
        for p_in in shipment_in.parcels:
            db_parcel = Parcel(
                shipment_id=db_shipment.id,
                weight_kg=p_in.weight_kg,
                length_cm=p_in.length_cm,
                width_cm=p_in.width_cm,
                height_cm=p_in.height_cm,
                category=p_in.category,
                is_hazardous=p_in.is_hazardous,
                is_fragile=p_in.is_fragile
            )
            db.add(db_parcel)
            total_weight += p_in.weight_kg
            
        # Update delivery point with shipment and weight
        dp_id = shipment_in.delivery_point_id
        
        # If ID is not a valid UUID, create a new DeliveryPoint from dest data
        is_uuid = True
        try:
            if not isinstance(dp_id, uuid.UUID):
                uuid.UUID(str(dp_id))
        except (ValueError, TypeError):
            is_uuid = False

        if not is_uuid:
            # Creation of new DeliveryPoint from Mapbox data
            new_dp = DeliveryPoint(
                name=shipment_in.dest_name or "New Location",
                address=shipment_in.dest_address or "Unknown Address",
                latitude=shipment_in.dest_lat or 0.0,
                longitude=shipment_in.dest_lng or 0.0,
                demand_kg=total_weight or shipment_in.total_weight_kg or 0.0,
                shipment_id=db_shipment.id,
                status="pending"
            )
            db.add(new_dp)
        else:
            # Use existing delivery point ID
            result = await db.execute(select(DeliveryPoint).where(DeliveryPoint.id == dp_id))
            dp = result.scalar_one_or_none()
            if dp:
                dp.shipment_id = db_shipment.id
                dp.demand_kg = total_weight or shipment_in.total_weight_kg or 1.0
            
        # Record initial log
        await ShipmentService.record_shipment_log(db, db_shipment.id, "created")
            
        await db.commit()
        # Explicit refresh and reload
        shipment = await ShipmentService.get_shipment(db, db_shipment.id)
        if not shipment:
            raise Exception("Failed to retrieve created shipment")
        return shipment

    @staticmethod
    async def get_public_tracking(db: AsyncSession, tracking_id: str) -> Optional[dict]:
        """
        Retrieves shipment, delivery point, and active vehicle telemetry for public tracking.
        """
        from sqlalchemy.orm import joinedload
        from app.models.models import RouteStop, Route, Vehicle
        
        # 1. Fetch shipment and delivery point
        result = await db.execute(
            select(Shipment)
            .options(selectinload(Shipment.delivery_point))
            .where(Shipment.tracking_id == tracking_id)
        )
        shipment = result.scalar_one_or_none()
        if not shipment:
            return None
        
        tracking_info = {
            "id": str(shipment.id),
            "tracking_id": shipment.tracking_id,
            "status": shipment.status,
            "priority": shipment.priority,
            "total_items": shipment.total_items,
            "total_weight_kg": shipment.total_weight_kg,
            "origin_name": shipment.origin_name,
            "origin_address": shipment.origin_address,
            "origin_lat": shipment.origin_lat,
            "origin_lng": shipment.origin_lng,
            "destination": {
                "name": shipment.delivery_point.name if shipment.delivery_point else None,
                "address": shipment.delivery_point.address if shipment.delivery_point else None,
                "lat": shipment.delivery_point.latitude if shipment.delivery_point else None,
                "lng": shipment.delivery_point.longitude if shipment.delivery_point else None,
            } if shipment.delivery_point else None,
            "vehicle": None,
            "eta_minutes": None,
        }
        
        # 2. Find route & vehicle if delivery point exists
        if shipment.delivery_point:
            # Find the route stop for this delivery point
            route_result = await db.execute(
                select(RouteStop)
                .options(joinedload(RouteStop.route).joinedload(Route.vehicle))
                .where(RouteStop.delivery_point_id == shipment.delivery_point.id)
            )
            route_stop = route_result.scalars().first()
            if route_stop and route_stop.route:
                route = route_stop.route
                vehicle = route.vehicle
                if vehicle:
                    tracking_info["vehicle"] = {
                        "plate_number": vehicle.plate_number,
                        "type": vehicle.vehicle_type,
                        "status": vehicle.status,
                        "lat": vehicle.latitude,
                        "lng": vehicle.longitude,
                    }
                # Calculate simple ETA from route total duration
                if route.status == "active":
                    tracking_info["eta_minutes"] = max(5.0, route.total_duration_minutes)
                    
        return tracking_info

    @staticmethod
    async def get_shipment(db: AsyncSession, shipment_id: uuid.UUID) -> Optional[Shipment]:
        result = await db.execute(
            select(Shipment)
            .options(
                selectinload(Shipment.delivery_point), 
                selectinload(Shipment.parcels),
                selectinload(Shipment.logs)
            )
            .where(Shipment.id == shipment_id)
        )
        shipment = result.scalar_one_or_none()
        if shipment:
            from app.services.security_service import SecurityService
            # Dynamic attribute for Pydantic serialization
            shipment.is_verified = SecurityService.verify_chain(shipment.logs)
        return shipment

    @staticmethod
    async def list_shipments(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[Shipment]:
        from app.services.security_service import SecurityService
        result = await db.execute(
            select(Shipment)
            .options(
                selectinload(Shipment.delivery_point), 
                selectinload(Shipment.parcels),
                selectinload(Shipment.logs)
            )
            .order_by(Shipment.created_at.desc())
            .offset(skip).limit(limit)
        )
        shipments = result.scalars().all()
        for s in shipments:
            s.is_verified = SecurityService.verify_chain(s.logs)
        return list(shipments)


    @staticmethod
    async def update_shipment_status(db: AsyncSession, shipment_id: uuid.UUID, status: str, lat: float = None, lng: float = None, received_by: str = None, signature_data: str = None) -> Optional[Shipment]:
        result = await db.execute(
            select(Shipment)
            .options(
                selectinload(Shipment.delivery_point), 
                selectinload(Shipment.parcels),
                selectinload(Shipment.logs)
            )
            .where(Shipment.id == shipment_id)
        )
        db_shipment = result.scalar_one_or_none()
        if db_shipment:
            db_shipment.status = status
            if received_by:
                db_shipment.received_by = received_by
            if signature_data:
                db_shipment.signature_data = signature_data
            
            # Record tamper-evident log with metadata if delivered
            metadata = {}
            if status == "delivered":
                metadata = {"received_by": received_by, "signature_captured": bool(signature_data)}

            await ShipmentService.record_shipment_log(db, shipment_id, status, lat, lng, metadata)
            await db.commit()
            await db.refresh(db_shipment)
            from app.services.security_service import SecurityService
            db_shipment.is_verified = SecurityService.verify_chain(db_shipment.logs)
        return db_shipment

    @staticmethod
    async def update_shipment(db: AsyncSession, shipment_id: uuid.UUID, update_data: dict) -> Optional[Shipment]:
        result = await db.execute(
            select(Shipment)
            .options(
                selectinload(Shipment.delivery_point), 
                selectinload(Shipment.parcels),
                selectinload(Shipment.logs)
            )
            .where(Shipment.id == shipment_id)
        )
        db_shipment = result.scalar_one_or_none()
        if not db_shipment:
            return None
            
        for key, value in update_data.items():
            if hasattr(db_shipment, key) and value is not None:
                setattr(db_shipment, key, value)
                
        await db.commit()
        await db.refresh(db_shipment)
        from app.services.security_service import SecurityService
        db_shipment.is_verified = SecurityService.verify_chain(db_shipment.logs)
        return db_shipment

    @staticmethod
    async def delete_shipment(db: AsyncSession, shipment_id: uuid.UUID) -> bool:
        from sqlalchemy import delete
        from app.models.models import Parcel, ShipmentLog, Invoice, Payment, DeliveryPoint, RouteStop
        
        result = await db.execute(select(Shipment).where(Shipment.id == shipment_id))
        shipment = result.scalar_one_or_none()
        if not shipment:
            return False
            
        # 1. Get associated delivery point
        dp_result = await db.execute(select(DeliveryPoint).where(DeliveryPoint.shipment_id == shipment_id))
        delivery_point = dp_result.scalar_one_or_none()
        
        # 2. Delete route stops
        if delivery_point:
            await db.execute(delete(RouteStop).where(RouteStop.delivery_point_id == delivery_point.id))
            
        # 3. Get associated invoices and delete payments
        invoices_result = await db.execute(select(Invoice.id).where(Invoice.shipment_id == shipment_id))
        invoice_ids = invoices_result.scalars().all()
        if invoice_ids:
            await db.execute(delete(Payment).where(Payment.invoice_id.in_(invoice_ids)))
            await db.execute(delete(Invoice).where(Invoice.shipment_id == shipment_id))
            
        # 4. Delete parcels and logs
        await db.execute(delete(Parcel).where(Parcel.shipment_id == shipment_id))
        await db.execute(delete(ShipmentLog).where(ShipmentLog.shipment_id == shipment_id))
        
        # 5. Delete delivery point
        if delivery_point:
            await db.execute(delete(DeliveryPoint).where(DeliveryPoint.shipment_id == shipment_id))
            
        # 6. Delete shipment
        await db.delete(shipment)
        await db.commit()
        return True

