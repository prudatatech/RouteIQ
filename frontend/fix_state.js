const fs = require('fs');

const path = 'd:\\margixindia-main\\frontend\\src\\pages\\ShipmentsPage.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. ShipmentsPage state
content = content.replace(
  "const [isModalOpen, setIsModalOpen] = useState(false)",
  "const [isModalOpen, setIsModalOpen] = useState(false)\n  const [isModalMinimized, setIsModalMinimized] = useState(false)"
);

// 2. Initialize button
content = content.replace(
  "onClick={() => setIsModalOpen(true)} className=\"h-16",
  "onClick={() => { setIsModalOpen(true); setIsModalMinimized(false); }} className=\"h-16"
);

// 3. AddShipmentModal usage
content = content.replace(
  "<AddShipmentModal \n        isOpen={isModalOpen} \n        onClose={() => setIsModalOpen(false)}",
  "<AddShipmentModal \n        isOpen={isModalOpen} \n        isMinimized={isModalMinimized}\n        setIsMinimized={setIsModalMinimized}\n        onClose={() => setIsModalOpen(false)}"
);

// 4. AddShipmentModal signature
content = content.replace(
  "function AddShipmentModal({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess?: (data: any) => void }) {",
  "function AddShipmentModal({ isOpen, onClose, onSuccess, isMinimized, setIsMinimized }: { isOpen: boolean; onClose: () => void; onSuccess?: (data: any) => void; isMinimized: boolean; setIsMinimized: (val: boolean) => void }) {"
);

// 5. Remove local isMinimized
content = content.replace(
  "const [isMinimized, setIsMinimized] = useState(false)",
  ""
);

// 6. Remove local search states
content = content.replace("const [searchTerm, setSearchTerm] = useState('')", "");
content = content.replace("const [originSearch, setOriginSearch] = useState('')", "");
content = content.replace("const [mobilePhone, setMobilePhone] = useState('')", "");
content = content.replace("const [selectedVehicleId, setSelectedVehicleId] = useState('')", "");

// 7. Add to formData defaults
content = content.replace(
  "tracking_id: `RTX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,",
  "tracking_id: `RTX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,\n      originSearch: '',\n      searchTerm: '',\n      mobilePhone: '',\n      selectedVehicleId: '',"
);

// 8. Replace references (be careful to replace exact matches)
// We will use regex with word boundaries where appropriate, but since these are variable names, it's safer.

content = content.replace(/\bsearchTerm\b/g, "formData.searchTerm");
content = content.replace(/\boriginSearch\b/g, "formData.originSearch");
content = content.replace(/\bmobilePhone\b/g, "formData.mobilePhone");
content = content.replace(/\bselectedVehicleId\b/g, "formData.selectedVehicleId");

// Fix setters
content = content.replace(/setSearchTerm\(([^)]+)\)/g, "setFormData({ ...formData, searchTerm: $1 })");
content = content.replace(/setOriginSearch\(([^)]+)\)/g, "setFormData({ ...formData, originSearch: $1 })");
content = content.replace(/setSelectedVehicleId\(([^)]+)\)/g, "setFormData({ ...formData, selectedVehicleId: $1 })");
content = content.replace(/setMobilePhone\(([^)]+)\)/g, "setFormData({ ...formData, mobilePhone: $1 })");

// Fix the pill logic to use formData.originSearch and formData.searchTerm as fallback
content = content.replace(
  "{formData.origin_name || 'No origin'} → {formData.delivery_point_name || 'No destination'}",
  "{formData.origin_name || formData.originSearch || 'No origin'} → {formData.delivery_point_name || formData.searchTerm || 'No destination'}"
);

// Fix the map selectedVehicleId prop in InlineTrackingMap because it might have accidentally replaced `selectedVehicleId={activeVehicle.id}`
// Wait, `selectedVehicleId` was replaced with `formData.selectedVehicleId`!
// Let's fix that back.
content = content.replace(
  "selectedVehicleId={activeVehicle.id}", // But wait, it was replaced to formData.selectedVehicleId={activeVehicle.id}
  "selectedVehicleId={activeVehicle.id}"
);
// Actually, `selectedVehicleId` as a JSX prop name shouldn't be replaced if I use a better regex.
// Let's undo the global replacements and use safer ones.
// I'll just write it back correctly.
