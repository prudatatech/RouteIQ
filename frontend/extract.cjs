const fs = require('fs');
const content = fs.readFileSync('src/pages/ShipmentsPage.tsx', 'utf8');

// Find the start and end of AddShipmentModal
const startIdx = content.indexOf('function AddShipmentModal');
const endIdx = content.indexOf('function EditShipmentModal');

if (startIdx === -1 || endIdx === -1) {
  console.log('Could not find bounds');
  process.exit(1);
}

const modalContent = content.substring(startIdx, endIdx);

// Extract constants CARGO_ARCHETYPES and PRIORITIES
const archStart = content.indexOf('const CARGO_ARCHETYPES');
const archEnd = content.indexOf('export default function ShipmentsPage');

const constantsContent = content.substring(archStart, archEnd);

// Combine imports and content
const newFileContent = `import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Package, Minus, X, Navigation, MapPin, Search, Loader2, Scale, Ruler, Layers, Zap, Smartphone, Calendar, Clock } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import LiveMap from '@/components/map/LiveMap';
import { shipmentsAPI, telemetryAPI, vehiclesAPI } from '@/services/api';
import { useDraftStore } from '@/store/draftStore';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

` + constantsContent + '\n\nexport default ' + modalContent;

fs.writeFileSync('src/components/modals/AddShipmentModal.tsx', newFileContent);
console.log('Created AddShipmentModal.tsx');

// Now remove the modal from ShipmentsPage.tsx
const newShipmentsContent = content.substring(0, startIdx) + content.substring(endIdx);
fs.writeFileSync('src/pages/ShipmentsPage.tsx', newShipmentsContent);
console.log('Removed from ShipmentsPage.tsx');
