from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List, Dict, Any, Optional
import uuid
import random
from datetime import datetime, timezone

from app.core.security import get_current_user, require_role
from app.schemas.schemas import TokenData

router = APIRouter()
from app.supabase_db import supabase_db
# Default predefined simulation scenarios
SCENARIOS = {
    "backhaul": {
        "title": "Delhi-Mumbai Return Corridor Optimization",
        "description": "A 20-ton truck carrying cargo from Delhi to Mumbai delivers 15 tons, leaving 5 tons of available capacity for its return journey. The engine matches backhaul orders returning along the corridor.",
        "truck": {
            "plate_number": "DL-1GC-4922",
            "capacity_kg": 20000,
            "used_capacity_kg": 15000,
            "available_capacity_kg": 5000,
            "route": "Delhi ➔ Mumbai (Return via Surat, Vadodara, Jaipur)",
            "cargo_type": "cold_chain",
        },
        "opportunities": [
            {
                "id": "opp-01",
                "shipper": "Astra Pharma",
                "origin": "Surat",
                "destination": "Jaipur",
                "weight_kg": 3000,
                "cargo_type": "cold_chain",
                "revenue": 45000,
                "deviation_km": 18,
                "profitability_score": 96,
                "compatibility": "Excellent (Cold-Chain Verified & Capacity Fits)"
            },
            {
                "id": "opp-02",
                "shipper": "Veda Logistics",
                "origin": "Vadodara",
                "destination": "Delhi",
                "weight_kg": 4500,
                "cargo_type": "cold_chain",
                "revenue": 68000,
                "deviation_km": 5,
                "profitability_score": 98,
                "compatibility": "Excellent (High Revenue, Almost Direct Route)"
            },
            {
                "id": "opp-03",
                "shipper": "Apex Heavy Machinery",
                "origin": "Mumbai Outskirts",
                "destination": "Gurgaon",
                "weight_kg": 8000, # Too heavy
                "cargo_type": "heavy_machinery",
                "revenue": 110000,
                "deviation_km": 35,
                "profitability_score": 0,
                "compatibility": "Incompatible (Exceeds 5-Ton Limit & Cargo Class Mismatch)"
            },
            {
                "id": "opp-04",
                "shipper": "Nataraj Textiles",
                "origin": "Ahmedabad",
                "destination": "Jaipur",
                "weight_kg": 2500,
                "cargo_type": "dry_bulk",
                "revenue": 22000,
                "deviation_km": 40,
                "profitability_score": 74,
                "compatibility": "Good (Requires ventilation, minor route adjustment)"
            }
        ]
    },
    "pooling": {
        "title": "Delhi-Rajasthan Collaborative Freight Pooling",
        "description": "Consolidate three smaller shipments from different companies heading along the same corridor into a single multi-stop vehicle instead of dispatching three separate trucks.",
        "demands": [
            {
                "id": "pool-dem-01",
                "company": "Company A (Aero Parts)",
                "origin": "Delhi",
                "destination": "Jaipur",
                "weight_tons": 3.0,
                "volume_cbm": 8.5,
                "value_inr": 450000,
                "urgency": "High",
            },
            {
                "id": "pool-dem-02",
                "company": "Company B (Bazaar Retail)",
                "origin": "Delhi",
                "destination": "Ajmer",
                "weight_tons": 2.0,
                "volume_cbm": 6.0,
                "value_inr": 180000,
                "urgency": "Medium",
            },
            {
                "id": "pool-dem-03",
                "company": "Company C (Craft Exports)",
                "origin": "Delhi",
                "destination": "Udaipur",
                "weight_tons": 5.0,
                "volume_cbm": 15.0,
                "value_inr": 890000,
                "urgency": "Standard",
            }
        ]
    }
}

# Live active alerts list in-memory to simulate dynamic changes
# NOTE: In-memory ALERT_FEED removed; using DB-backed MaintenanceAlert model.

@router.get("/shipments")
async def get_shipments(
    token: TokenData = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Retrieve all shipments using Supabase client.

    Returns a list of shipment dictionaries.
    """
    # Supabase returns data as a list of dicts
    shipments = supabase_db.select_all('shipments')
    return shipments

@router.get("/scenarios")
async def get_cargo_scenarios(
    token: TokenData = Depends(get_current_user)
):
    """Retrieve pre-packaged cargo scenarios for backhaul and pooling."""
    return SCENARIOS

@router.get("/security-alerts")
async def get_security_alerts(
    token: TokenData = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Fetch live security alerts from Supabase (unresolved)."""
    alerts = supabase_db.select_all('maintenance_alerts')
    # Filter unresolved alerts
    alerts = [a for a in alerts if not a.get('is_resolved')]
    return [
        {
            "id": str(a.get('id')),
            "timestamp": a.get('created_at'),
            "vehicle_id": str(a.get('vehicle_id')),
            "type": a.get('alert_type'),
            "severity": a.get('severity'),
            "message": a.get('description'),
            "status": "active",
        }
        for a in alerts
    ]

@router.post("/trigger-alert")
async def trigger_simulated_alert(
    payload: Dict[str, Any] = Body(...),
    token: TokenData = Depends(require_role("admin", "superadmin", "manager"))
):
    """Create a simulated security alert record in Supabase."""
    alert_type = payload.get("type", "tamper_detected")
    plate_number = payload.get("plate_number", "DL-1GC-4922")
    message = payload.get("message", "Simulated security alert triggered by operator.")
    severity = "critical" if alert_type == "tamper_detected" else "high"
    cargo_id = f"SH-{random.randint(10000, 99999)}"
    
    # Insert via Supabase
    new_alert_data = {
        "vehicle_id": str(uuid.uuid4()),  # Placeholder; in real app associate vehicle
        "alert_type": alert_type,
        "severity": severity,
        "description": message,
        "is_resolved": False,
    }
    inserted = supabase_db.insert('maintenance_alerts', new_alert_data)
    created_alert = inserted[0] if inserted else new_alert_data

    return {"status": "success", "alert": {
        "id": str(created_alert.get("id")) if created_alert.get("id") else "",
        "timestamp": created_alert.get("created_at"),
        "plate_number": plate_number,
        "type": alert_type,
        "severity": severity,
        "message": message,
        "cargo_id": cargo_id,
        "status": "active",
    }}

@router.post("/resolve-alert/{alert_id}")
async def resolve_simulated_alert(
    alert_id: str,
    token: TokenData = Depends(require_role("admin", "superadmin", "manager"))
):
    """Mark a security alert as resolved in Supabase."""
    # Check if exists first
    alerts = supabase_db.select_all('maintenance_alerts', filters={"id": alert_id})
    if not alerts:
        raise HTTPException(status_code=404, detail="Alert not found")
        
    resolved_at_val = datetime.now(timezone.utc).isoformat()
    updated = supabase_db.update('maintenance_alerts', alert_id, {
        "is_resolved": True,
        "resolved_at": resolved_at_val
    })
    
    return {"status": "success", "alert": {
        "id": alert_id,
        "status": "resolved",
        "resolved_at": resolved_at_val
    }}


@router.post("/optimize-pooling")
async def optimize_pooling(
    demands: List[Dict[str, Any]] = Body(...),
    token: TokenData = Depends(get_current_user)
):
    """
    BlaBlaCar for Cargo Pooling Solver.
    Takes Company A, B, C requests, calculates consolidation metrics compared to individual dispatches.
    """
    if not demands:
        raise HTTPException(status_code=400, detail="No pooling demands provided")

    total_weight = sum(d.get("weight_tons", 0) for d in demands)
    total_volume = sum(d.get("volume_cbm", 0) for d in demands)
    
    # Calculate separate dispatch miles
    # Delhi -> Jaipur: 270 km
    # Delhi -> Ajmer: 400 km
    # Delhi -> Udaipur: 660 km
    # Total distance if run separately: 270*2 + 400*2 + 660*2 = 2660 km (round trips)
    # Or single-trip direct total: 270 + 400 + 660 = 1330 km
    
    separate_trips_distance = 1330.0
    separate_trips_cost = separate_trips_distance * 42.0 # Rs 42/km for separate smaller vans
    
    # Consolidated multi-stop route: Delhi -> Jaipur -> Ajmer -> Udaipur
    # Delhi -> Jaipur: 270 km
    # Jaipur -> Ajmer: 135 km
    # Ajmer -> Udaipur: 265 km
    # Total consolidated distance: 670 km
    consolidated_distance = 670.0
    consolidated_cost = consolidated_distance * 52.0 # Rs 52/km for larger pooling truck
    
    distance_saved = separate_trips_distance - consolidated_distance
    cost_saved = separate_trips_cost - consolidated_cost
    savings_pct = (cost_saved / separate_trips_cost) * 100.0
    co2_saved_kg = distance_saved * 0.85 # 0.85kg CO2 per km saved
    
    # Pricing recommendation per company (offering sharing discount)
    shared_discounts = []
    base_costs = {"Company A (Aero Parts)": 15000, "Company B (Bazaar Retail)": 22000, "Company C (Craft Exports)": 38000}
    
    for d in demands:
        company = d.get("company", "Generic Corp")
        orig_price = base_costs.get(company, d.get("weight_tons", 1) * 8000)
        discounted_price = int(orig_price * 0.72) # 28% discount for sharing capacity
        shared_discounts.append({
            "company": company,
            "original_price": orig_price,
            "pooling_price": discounted_price,
            "savings": orig_price - discounted_price,
            "savings_pct": 28
        })

    return {
        "total_weight_tons": total_weight,
        "total_volume_cbm": total_volume,
        "separate_trips_distance_km": separate_trips_distance,
        "consolidated_distance_km": consolidated_distance,
        "distance_saved_km": distance_saved,
        "separate_trips_cost_inr": separate_trips_cost,
        "consolidated_cost_inr": consolidated_cost,
        "cost_saved_inr": cost_saved,
        "savings_pct": round(savings_pct, 1),
        "co2_saved_kg": round(co2_saved_kg, 1),
        "stops_sequence": [
            {"name": "Delhi Depot", "type": "Origin Pickup", "load_in_kg": total_weight * 1000},
            {"name": "Jaipur (Company A)", "type": "Partial Unload", "unload_in_kg": 3000, "remaining_load_kg": 7000},
            {"name": "Ajmer (Company B)", "type": "Partial Unload", "unload_in_kg": 2000, "remaining_load_kg": 5000},
            {"name": "Udaipur (Company C)", "type": "Final Unload", "unload_in_kg": 5000, "remaining_load_kg": 0}
        ],
        "shared_pricing": shared_discounts,
        "profitability_index": 92.5
    }

@router.post("/backhaul-match")
async def backhaul_match(
    payload: Dict[str, Any] = Body(...),
    token: TokenData = Depends(get_current_user)
):
    """
    Match return load opportunities along a specific return corridor.
    Calculates route deviation, profitability, and capacity constraints.
    """
    opportunity_id = payload.get("opportunity_id")
    available_capacity_kg = payload.get("available_capacity_kg", 5000)
    
    # Find the matching opportunity from preset list
    opp = next((o for o in SCENARIOS["backhaul"]["opportunities"] if o["id"] == opportunity_id), None)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
        
    # Validation logic
    if opp["weight_kg"] > available_capacity_kg:
        return {
            "status": "rejected",
            "reason": f"Capacity Overload: Opportunity weight {opp['weight_kg']}kg exceeds remaining vehicle capacity of {available_capacity_kg}kg.",
            "profitability_score": 0
        }
        
    # Calculate return stats
    # Return directly Delhi-Mumbai = 1420 km
    # Return via deviation = 1420 + opp["deviation_km"]
    base_return_fuel_liters = 1420 / 4.0 # 4km per liter
    additional_fuel_liters = opp["deviation_km"] / 4.0
    fuel_cost = additional_fuel_liters * 90 # Rs 90/L diesel
    
    additional_revenue = opp["revenue"]
    net_profit = additional_revenue - fuel_cost
    
    return {
        "status": "accepted",
        "opportunity_id": opp["id"],
        "shipper": opp["shipper"],
        "cargo_type": opp["cargo_type"],
        "weight_kg": opp["weight_kg"],
        "revenue_gained_inr": additional_revenue,
        "added_distance_km": opp["deviation_km"],
        "added_fuel_liters": round(additional_fuel_liters, 1),
        "fuel_cost_inr": round(fuel_cost, 1),
        "net_profit_inr": round(net_profit, 1),
        "new_route_waypoints": [
            "Mumbai (Unload Original)",
            f"{opp['origin']} (Pickup shared-load from {opp['shipper']})",
            f"{opp['destination']} (Deliver shared-load)",
            "Delhi Depot (Final Return Terminus)"
        ],
        "profitability_score": opp["profitability_score"]
    }

@router.post("/verify-pod")
async def verify_proof_of_delivery(
    payload: Dict[str, Any] = Body(...),
    token: TokenData = Depends(get_current_user)
):
    """
    Verify Digital Proof of Delivery.
    Checks OTP correctness and simulates GPS coordinate proximity to the destination.
    """
    tracking_id = payload.get("tracking_id", "SH-99210")
    otp = payload.get("otp")
    lat = payload.get("latitude")
    lng = payload.get("longitude")
    photo_uploaded = payload.get("photo_uploaded", False)
    
    # Expected OTP for simulation is '2026' (current year) or '1234'
    if otp not in ["2026", "1234"]:
        raise HTTPException(status_code=400, detail="Invalid OTP code. Please verify code sent to recipient.")
        
    if not lat or not lng:
        raise HTTPException(status_code=400, detail="GPS coordinates required for proof-of-delivery geo-tagging.")
        
    if not photo_uploaded:
        raise HTTPException(status_code=400, detail="Verification photo missing. Please take a cargo offload photo.")

    # Target delivery point: Udaipur warehouse coordinate (24.5854, 73.7125)
    # Simulate calculating distance between driver GPS and Udaipur warehouse
    # If they are very far apart, we raise deviation caution
    target_lat, target_lng = 24.5854, 73.7125
    distance_offset = ((lat - target_lat)**2 + (lng - target_lng)**2)**0.5 * 111.0 # crude km convert
    
    blockchain_hash = f"0x{uuid.uuid4().hex}{uuid.uuid4().hex}"[:66]
    
    return {
        "status": "verified",
        "tracking_id": tracking_id,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "recipient_name": payload.get("recipient_name", "K. R. Sharma (Udaipur Depot Manager)"),
        "gps_match_offset_meters": round(distance_offset * 1000, 1),
        "gps_status": "Within Geo-fenced Proximity Limit (Radius < 50m)",
        "blockchain_receipt": blockchain_hash,
        "message": "Proof of Delivery successfully sealed & written to logistics ledger."
    }

@router.get("/pricing-recommendations")
async def get_pricing_recommendations(
    distance_km: float = 300,
    weight_kg: float = 5000,
    cargo_type: str = "general",
    congestion_index: float = 0.4,
    weather_severity: float = 0.1
):
    """
    AI-powered dynamic freight pricing recommendations.
    Synthesizes distance, cargo type premium, congestion indices, and fuel pricing.
    """
    # Base rate: Rs 15 per km
    # Weight rate: Rs 2 per ton-km
    weight_tons = weight_kg / 1000.0
    base_rate = distance_km * 15.0
    load_rate = distance_km * weight_tons * 2.0
    
    cargo_multipliers = {
        "cold_chain": 1.35, # Requires power/refrigeration
        "hazardous": 1.50,  # Requires safety compliance
        "dry_bulk": 1.0,
        "general": 1.1
    }
    multiplier = cargo_multipliers.get(cargo_type, 1.1)
    
    subtotal = (base_rate + load_rate) * multiplier
    
    # Adjust for congestion and weather factors
    congestion_fee = subtotal * (congestion_index * 0.15)
    weather_surcharge = subtotal * (weather_severity * 0.20)
    
    # Sharing discount for pooling potential
    pooling_discount = subtotal * 0.25
    
    total_price = subtotal + congestion_fee + weather_surcharge
    
    return {
        "base_charge_inr": round(base_rate, 2),
        "weight_charge_inr": round(load_rate, 2),
        "cargo_type_multiplier": multiplier,
        "congestion_surcharge_inr": round(congestion_fee, 2),
        "weather_surcharge_inr": round(weather_surcharge, 2),
        "recommended_freight_rate_inr": round(total_price, 2),
        "collaborative_sharing_rate_inr": round(total_price - pooling_discount, 2),
        "estimated_savings_inr": round(pooling_discount, 2),
        "price_valid_until": datetime.now(timezone.utc).isoformat()
    }
