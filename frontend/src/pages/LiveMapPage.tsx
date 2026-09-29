import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { vehiclesAPI } from '@/services/api';
import LiveMap from '@/components/map/LiveMap';

// Full-screen fleet map. LiveMap draws each vehicle from its last stored position
// and follows live GPS updates over Supabase realtime.
const LiveMapPage: React.FC = () => {
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'live'],
    queryFn: () => vehiclesAPI.list({ limit: 500 }),
    refetchInterval: 30_000,
  });

  const fleet = vehicles.filter((v: { status?: string }) => v.status !== 'archived');

  // The app layout pads the page by 2rem top and bottom
  return (
    <div className="h-[calc(100vh-4rem)] w-full">
      <LiveMap vehicles={fleet} />
    </div>
  );
};

export default LiveMapPage;
