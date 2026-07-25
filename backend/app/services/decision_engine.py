import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Vehicle, Shipment
from app.ml.bin_packer import bin_packer, Item, Bin

class AIDecisionEngine:
    """
    Advanced AI Decision Engine for Fleet & Cargo Optimization.
    Handles vehicle suggestions, load optimization checks, and risk analysis.
    """
    
    @staticmethod
    async def suggest_best_vehicle(db: AsyncSession, shipment_id: uuid.UUID) -> dict:
        # 1. Fetch Shipment and its parcels
        result = await db.execute(select(Shipment).where(Shipment.id == shipment_id))
        shipment = result.scalar_one_or_none()
        if not shipment:
            return {"error": "Shipment not found"}
            
        total_weight = sum(p.weight_kg for p in shipment.parcels)
        items = [
            Item(id=str(p.id), width=p.width_cm, height=p.height_cm, depth=p.length_cm, weight=p.weight_kg)
            for p in shipment.parcels
        ]
        
        # 2. Fetch all available vehicles
        result = await db.execute(select(Vehicle).where(Vehicle.status == "available"))
        vehicles = result.scalars().all()
        
        suggestions = []
        for v in vehicles:
            # Check capacity first
            if v.capacity_kg < total_weight:
                continue
                
            # Perform 3D Bin Packing check
            container = Bin(width=200, height=200, depth=400, max_weight=v.capacity_kg) # Mock vehicle dimensions
            pack_result = bin_packer.pack(container, items)
            
            if not pack_result["unpacked_items"]:
                # Calculate "Suitability Score" based on fuel efficiency and spare capacity
                # Higher is better
                score = (1 / (v.fuel_efficiency_kmpl or 1)) * 100 
                score += (1 - (total_weight / v.capacity_kg)) * 50
                
                suggestions.append({
                    "vehicle_id": v.id,
                    "plate_number": v.plate_number,
                    "type": v.vehicle_type,
                    "suitability_score": round(score, 2),
                    "load_utilization": pack_result["weight_utilization_pct"],
                    "estimated_fuel_cost_index": round(10 / (v.fuel_efficiency_kmpl or 1), 2)
                })
        
        # Sort by score descending
        suggestions.sort(key=lambda x: x["suitability_score"], reverse=True)
        
        return {
            "shipment_id": shipment_id,
            "total_weight_kg": total_weight,
            "recommended_vehicle": suggestions[0] if suggestions else None,
            "all_options": suggestions[:3]
        }

    @staticmethod
    def analyze_route_risk(route_data: dict, traffic_density: float, weather_severity: float) -> dict:
        """
        AI risk analysis for a planned route.
        """
        base_risk = 5.0 # baseline 5%
        traffic_risk = traffic_density * 40 # up to 40%
        weather_risk = weather_severity * 30 # up to 30%
        
        total_risk = min(95.0, base_risk + traffic_risk + weather_risk)
        
        suggestions = []
        if total_risk > 60:
            suggestions.append("High risk detected: Consider postponing or using a heavy-duty vehicle.")
        if traffic_density > 0.7:
            suggestions.append("Severe traffic dynamic routing recommended.")
            
        return {
            "risk_score": round(total_risk, 1),
            "status": "high_risk" if total_risk > 70 else "moderate" if total_risk > 30 else "low_risk",
            "ai_suggestions": suggestions
        }

decision_engine = AIDecisionEngine()
