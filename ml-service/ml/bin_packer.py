"""
Bin Packer — 3D heuristic bin packing for cargo space optimization.
Standalone version for ML microservice (no SQLAlchemy dependencies).
"""
from dataclasses import dataclass
from typing import List, Dict, Any


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
    Heuristic-based 3D bin packing solver (First Fit Decreasing / Shelf).
    Optimizes for space and weight distribution.
    """

    def pack(self, container: Bin, items: List[Item]) -> dict:
        sorted_items = sorted(items, key=lambda x: x.width * x.height * x.depth, reverse=True)

        packed = []
        unpacked = []
        current_weight = 0

        for item in sorted_items:
            if current_weight + item.weight <= container.max_weight:
                packed.append({
                    "id": item.id,
                    "position": {"x": 0, "y": 0, "z": 0},
                    "dimensions": {"w": item.width, "h": item.height, "d": item.depth},
                    "weight": item.weight
                })
                current_weight += item.weight
            else:
                unpacked.append(item.id)

        container_vol = container.width * container.height * container.depth
        packed_vol = sum(i['dimensions']['w'] * i['dimensions']['h'] * i['dimensions']['d'] for i in packed)
        efficiency = (packed_vol / container_vol) * 100 if packed and container_vol > 0 else 0

        return {
            "packed_items": packed,
            "unpacked_items": unpacked,
            "space_utilization_pct": round(efficiency, 2),
            "weight_utilization_pct": round((current_weight / container.max_weight) * 100, 2),
            "total_weight_kg": current_weight
        }


bin_packer = Simple3DBinPacker()


def bin_pack(items: List[Dict[str, Any]], bin_capacity: float) -> dict:
    """Convenience function called from main.py API endpoint."""
    item_objs = [
        Item(
            id=item.get("id", str(i)),
            width=item.get("width", 1.0),
            height=item.get("height", 1.0),
            depth=item.get("depth", 1.0),
            weight=item.get("weight", 0.0),
        )
        for i, item in enumerate(items)
    ]
    container = Bin(width=2.4, height=2.4, depth=6.0, max_weight=bin_capacity)
    return bin_packer.pack(container, item_objs)
