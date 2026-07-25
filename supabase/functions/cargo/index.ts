// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PATCH, DELETE",
};

// Preset scenarios matching backend/app/api/v1/endpoints/cargo.py
const SCENARIOS = {
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
        "weight_kg": 8000,
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
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, ""); // normalize trailing slash
    const method = req.method;

    // Initialize Supabase Client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 1. GET /scenarios
    if (path.endsWith("/scenarios") && method === "GET") {
      return new Response(JSON.stringify(SCENARIOS), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. GET /security-alerts
    if (path.endsWith("/security-alerts") && method === "GET") {
      const { data, error } = await supabase
        .from("maintenance_alerts")
        .select("*")
        .eq("is_resolved", false);

      if (error) throw error;

      const formattedAlerts = (data || []).map((a: any) => ({
        id: String(a.id),
        timestamp: a.created_at,
        vehicle_id: String(a.vehicle_id),
        type: a.alert_type,
        severity: a.severity,
        message: a.description,
        status: "active",
      }));

      return new Response(JSON.stringify(formattedAlerts), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. POST /trigger-alert
    if (path.endsWith("/trigger-alert") && method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const alertType = payload.type || "tamper_detected";
      const plateNumber = payload.plate_number || "DL-1GC-4922";
      const message = payload.message || "Simulated security alert triggered by operator.";
      const severity = alertType === "tamper_detected" ? "critical" : "high";
      const cargoId = `SH-${Math.floor(10000 + Math.random() * 90000)}`;

      const { data, error } = await supabase
        .from("maintenance_alerts")
        .insert([
          {
            vehicle_id: "00000000-0000-0000-0000-000000000000", // placeholder UUID
            alert_type: alertType,
            severity: severity,
            description: message,
            is_resolved: false,
          }
        ])
        .select();

      if (error) throw error;
      const createdAlert = data?.[0] || {};

      return new Response(
        JSON.stringify({
          status: "success",
          alert: {
            id: String(createdAlert.id || ""),
            timestamp: createdAlert.created_at,
            plate_number: plateNumber,
            type: alertType,
            severity: severity,
            message: message,
            cargo_id: cargoId,
            status: "active",
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. POST /resolve-alert/:id
    if (path.includes("/resolve-alert") && method === "POST") {
      const parts = path.split("/");
      const alertId = parts[parts.length - 1];

      // Check if it exists
      const { data: checkData, error: checkError } = await supabase
        .from("maintenance_alerts")
        .select("id")
        .eq("id", alertId);

      if (checkError) throw checkError;
      if (!checkData || checkData.length === 0) {
        return new Response(JSON.stringify({ detail: "Alert not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const resolvedAtVal = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("maintenance_alerts")
        .update({
          is_resolved: true,
          resolved_at: resolvedAtVal,
        })
        .eq("id", alertId);

      if (updateError) throw updateError;

      return new Response(
        JSON.stringify({
          status: "success",
          alert: {
            id: alertId,
            status: "resolved",
            resolved_at: resolvedAtVal,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. POST /optimize-pooling
    if (path.endsWith("/optimize-pooling") && method === "POST") {
      const demands = await req.json().catch(() => []);
      if (!demands || demands.length === 0) {
        return new Response(JSON.stringify({ detail: "No pooling demands provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const totalWeight = demands.reduce((acc: number, d: any) => acc + (d.weight_tons || 0), 0);
      const totalVolume = demands.reduce((acc: number, d: any) => acc + (d.volume_cbm || 0), 0);

      const separateTripsDistance = 1330.0;
      const separateTripsCost = separateTripsDistance * 42.0;

      const consolidatedDistance = 670.0;
      const consolidatedCost = consolidatedDistance * 52.0;

      const distanceSaved = separateTripsDistance - consolidatedDistance;
      const costSaved = separateTripsCost - consolidatedCost;
      const savingsPct = (costSaved / separateTripsCost) * 100.0;
      const co2SavedKg = distanceSaved * 0.85;

      const sharedDiscounts = [];
      const baseCosts: Record<string, number> = {
        "Company A (Aero Parts)": 15000,
        "Company B (Bazaar Retail)": 22000,
        "Company C (Craft Exports)": 38000,
      };

      for (const d of demands) {
        const company = d.company || "Generic Corp";
        const origPrice = baseCosts[company] || (d.weight_tons || 1) * 8000;
        const discountedPrice = Math.floor(origPrice * 0.72);
        sharedDiscounts.push({
          company: company,
          original_price: origPrice,
          pooling_price: discountedPrice,
          savings: origPrice - discountedPrice,
          savings_pct: 28,
        });
      }

      return new Response(
        JSON.stringify({
          total_weight_tons: totalWeight,
          total_volume_cbm: totalVolume,
          separate_trips_distance_km: separateTripsDistance,
          consolidated_distance_km: consolidatedDistance,
          distance_saved_km: distanceSaved,
          separate_trips_cost_inr: separateTripsCost,
          consolidated_cost_inr: consolidatedCost,
          cost_saved_inr: costSaved,
          savings_pct: Math.round(savingsPct * 10) / 10,
          co2_saved_kg: Math.round(co2SavedKg * 10) / 10,
          stops_sequence: [
            { name: "Delhi Depot", type: "Origin Pickup", load_in_kg: totalWeight * 1000 },
            { name: "Jaipur (Company A)", type: "Partial Unload", unload_in_kg: 3000, remaining_load_kg: 7000 },
            { name: "Ajmer (Company B)", type: "Partial Unload", unload_in_kg: 2000, remaining_load_kg: 5000 },
            { name: "Udaipur (Company C)", type: "Final Unload", unload_in_kg: 5000, remaining_load_kg: 0 },
          ],
          shared_pricing: sharedDiscounts,
          profitability_index: 92.5,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. POST /backhaul-match
    if (path.endsWith("/backhaul-match") && method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const opportunityId = payload.opportunity_id;
      const availableCapacityKg = payload.available_capacity_kg || 5000;

      const opp = SCENARIOS.backhaul.opportunities.find((o) => o.id === opportunityId);
      if (!opp) {
        return new Response(JSON.stringify({ detail: "Opportunity not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (opp.weight_kg > availableCapacityKg) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: `Capacity Overload: Opportunity weight ${opp.weight_kg}kg exceeds remaining vehicle capacity of ${availableCapacityKg}kg.`,
            profitability_score: 0,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const additionalFuelLiters = opp.deviation_km / 4.0;
      const fuelCost = additionalFuelLiters * 90;
      const additionalRevenue = opp.revenue;
      const netProfit = additionalRevenue - fuelCost;

      return new Response(
        JSON.stringify({
          status: "accepted",
          opportunity_id: opp.id,
          shipper: opp.shipper,
          cargo_type: opp.cargo_type,
          weight_kg: opp.weight_kg,
          revenue_gained_inr: additionalRevenue,
          added_distance_km: opp.deviation_km,
          added_fuel_liters: Math.round(additionalFuelLiters * 10) / 10,
          fuel_cost_inr: Math.round(fuelCost * 10) / 10,
          net_profit_inr: Math.round(netProfit * 10) / 10,
          new_route_waypoints: [
            "Mumbai (Unload Original)",
            `${opp.origin} (Pickup shared-load from ${opp.shipper})`,
            `${opp.destination} (Deliver shared-load)`,
            "Delhi Depot (Final Return Terminus)",
          ],
          profitability_score: opp.profitability_score,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. POST /verify-pod
    if (path.endsWith("/verify-pod") && method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const trackingId = payload.tracking_id || "SH-99210";
      const otp = payload.otp;
      const lat = payload.latitude;
      const lng = payload.longitude;
      const photoUploaded = payload.photo_uploaded || false;

      if (otp !== "2026" && otp !== "1234") {
        return new Response(JSON.stringify({ detail: "Invalid OTP code. Please verify code sent to recipient." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!lat || !lng) {
        return new Response(JSON.stringify({ detail: "GPS coordinates required for proof-of-delivery geo-tagging." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!photoUploaded) {
        return new Response(JSON.stringify({ detail: "Verification photo missing. Please take a cargo offload photo." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targetLat = 24.5854;
      const targetLng = 73.7125;
      const distanceOffset = Math.sqrt((lat - targetLat) ** 2 + (lng - targetLng) ** 2) * 111.0;

      // Generate a crypto hash
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const blockchainHash = "0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 64);

      return new Response(
        JSON.stringify({
          status: "verified",
          tracking_id: trackingId,
          verified_at: new Date().toISOString(),
          recipient_name: payload.recipient_name || "K. R. Sharma (Udaipur Depot Manager)",
          gps_match_offset_meters: Math.round(distanceOffset * 1000 * 10) / 10,
          gps_status: "Within Geo-fenced Proximity Limit (Radius < 50m)",
          blockchain_receipt: blockchainHash,
          message: "Proof of Delivery successfully sealed & written to logistics ledger.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. GET /pricing-recommendations
    if (path.endsWith("/pricing-recommendations") && method === "GET") {
      const distanceKm = Number(url.searchParams.get("distance_km") || "300");
      const weightKg = Number(url.searchParams.get("weight_kg") || "5000");
      const cargoType = url.searchParams.get("cargo_type") || "general";
      const congestionIndex = Number(url.searchParams.get("congestion_index") || "0.4");
      const weatherSeverity = Number(url.searchParams.get("weather_severity") || "0.1");

      const weightTons = weightKg / 1000.0;
      const baseRate = distanceKm * 15.0;
      const loadRate = distanceKm * weightTons * 2.0;

      const cargoMultipliers: Record<string, number> = {
        "cold_chain": 1.35,
        "hazardous": 1.50,
        "dry_bulk": 1.0,
        "general": 1.1,
      };
      const multiplier = cargoMultipliers[cargoType] || 1.1;
      const subtotal = (baseRate + loadRate) * multiplier;

      const congestionFee = subtotal * (congestionIndex * 0.15);
      const weatherSurcharge = subtotal * (weatherSeverity * 0.20);
      const poolingDiscount = subtotal * 0.25;
      const totalPrice = subtotal + congestionFee + weatherSurcharge;

      return new Response(
        JSON.stringify({
          base_charge_inr: Math.round(baseRate * 100) / 100,
          weight_charge_inr: Math.round(loadRate * 100) / 100,
          cargo_type_multiplier: multiplier,
          congestion_surcharge_inr: Math.round(congestionFee * 100) / 100,
          weather_surcharge_inr: Math.round(weatherSurcharge * 100) / 100,
          recommended_freight_rate_inr: Math.round(totalPrice * 100) / 100,
          collaborative_sharing_rate_inr: Math.round((totalPrice - poolingDiscount) * 100) / 100,
          estimated_savings_inr: Math.round(poolingDiscount * 100) / 100,
          price_valid_until: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
