import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { useNavigate } from 'react-router-dom';

export default function SOSListener() {
  const role = useAuthStore(s => s.role);
  const navigate = useNavigate();
  const [alert, setAlert] = useState<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Only superadmins and admins should hear/see the siren
    if (role !== 'superadmin' && role !== 'admin') return;

    audioRef.current = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
    audioRef.current.loop = true;

    const channel = supabase
      .channel('sos_alerts_channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sos_alerts' },
        (payload) => {
          setAlert(payload.new);
          if (audioRef.current) {
            audioRef.current.play().catch(e => console.error('Audio play prevented by browser:', e));
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [role]);

  if (!alert) return null;

  const dismissAlert = () => {
    setAlert(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const getAlertTitle = () => {
    switch(alert.alert_type) {
      case 'accident_serious': return 'SERIOUS ACCIDENT';
      case 'accident_non_serious': return 'NON-SERIOUS ACCIDENT';
      case 'vehicle_damage': return 'VEHICLE DAMAGE';
      default: return 'SOS EMERGENCY';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(239, 68, 68, 0.9)',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      color: 'white',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '4rem', fontWeight: '900', marginBottom: '1rem', textTransform: 'uppercase', animation: 'pulse 1s infinite' }}>
        {getAlertTitle()}
      </h1>
      <p style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>
        Driver triggered an emergency alert!
      </p>
      
      {alert.latitude && alert.longitude && (
        <button 
          onClick={() => {
            dismissAlert();
            navigate('/emergency');
          }}
          style={{
            backgroundColor: 'white',
            color: '#EF4444',
            padding: '1rem 2rem',
            borderRadius: '0.5rem',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            textDecoration: 'none',
            marginBottom: '2rem',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          VIEW IN EMERGENCY DASHBOARD
        </button>
      )}

      {alert.description && alert.description !== 'Driver triggered SOS emergency alert' && (
        <p style={{ fontSize: '1.25rem', marginBottom: '2rem', fontStyle: 'italic', maxWidth: '600px' }}>
          "{alert.description}"
        </p>
      )}

      <button 
        onClick={dismissAlert}
        style={{
          background: 'transparent',
          border: '2px solid white',
          color: 'white',
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          cursor: 'pointer',
          marginTop: 'auto'
        }}
      >
        DISMISS SIREN
      </button>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); color: #FFF0F0; }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
