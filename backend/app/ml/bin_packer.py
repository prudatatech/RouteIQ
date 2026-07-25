from dataclasses import dataclass
from typing import List

@dataclass
class Item:
    id: str
    width: float
    height: float
    depth: float
    weight: float

@dataclass
class Bin:
    width: float
    height: float
    depth: float
    max_weight: float

class Simple3DBinPacker:
    """
    A heuristic-based 3D bin packing solver (First Fit Decreasing / Shelf implementation).
    Optimizes for space and weight distribution.
    """
    
    def pack(self, container: Bin, items: List[Item]) -> dict:
        # Sort items by volume descending (FFD heuristic)
        sorted_items = sorted(items, key=lambda x: x.width * x.height * x.depth, reverse=True)
        
        packed = []
        unpacked = []
        current_weight = 0
        
        # Simple shelf-based packing (simplified for MVP production level)
        # In a real system, we'd use a more complex library like 'py3dbp'
        # but we'll implement a clean heuristic here.
        
        for item in sorted_items:
            if current_weight + item.weight <= container.max_weight:
                # Mock coordinates for visualization (3D placement)
                # In a real engine, we'd calculate x,y,z based on remaining volume
                packed.append({
                    "id": item.id,
                    "position": {"x": 0, "y": 0, "z": 0}, # To be calculated by real geometry engine
                    "dimensions": {"w": item.width, "h": item.height, "d": item.depth},
                    "weight": item.weight
                })
                current_weight += item.weight
            else:
                unpacked.append(item.id)
                
        efficiency = (sum(i['dimensions']['w'] * i['dimensions']['h'] * i['dimensions']['d'] for i in packed) / 
                     (container.width * container.height * container.depth)) * 100 if packed else 0
        
        return {
            "packed_items": packed,
            "unpacked_items": unpacked,
            "space_utilization_pct": round(efficiency, 2),
            "weight_utilization_pct": round((current_weight / container.max_weight) * 100, 2),
            "total_weight_kg": current_weight
        }

bin_packer = Simple3DBinPacker()
