'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

interface TempLog {
  id: string;
  temperature: number;
  humidity?: number;
  location: string;
  timestamp: string;
  sensorId?: string;
  /** The simulator writes rows with this flag set. A reading without it came
      from a physical sensor. The two must not be displayed as one column. */
  isSimulated?: boolean;
}

interface ColdChainStats {
  totalReadings: number;
  simulatedReadings: number;
  realReadings: number;
  temperature: { min: number; max: number; avg: number; breaches: number; breachPercent: number } | null;
  humidity: { min: number; max: number; avg: number } | null;
}

export default function TransporterDashboard() {
  const [batchId, setBatchId] = useState('AGR-2026-UK-284701');
  const [history, setHistory] = useState<TempLog[]>([]);
  const [stats, setStats] = useState<ColdChainStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simBatchId, setSimBatchId] = useState('AGR-2026-UK-284701');
  const [simSensorId, setSimSensorId] = useState('IOT-REEFER-001');
  const [simHours, setSimHours] = useState('24');
  const [simMsg, setSimMsg] = useState('');

  // Manual reading state
  const [manualTemp, setManualTemp] = useState('12.5');
  const [manualHumidity, setManualHumidity] = useState('85');
  const [manualLocation, setManualLocation] = useState('Arabian Sea Vessel');
  const [postingReading, setPostingReading] = useState(false);

  const fetchHistory = async (code?: string) => {
    const target = code || batchId;
    if (!target) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/iot/batches/${encodeURIComponent(target)}/history`);
      const json = await res.json();
      if (json.success) {
        // The route returns { batch, readings, summary }. This page read
        // `json.data.logs` and `json.data.stats`, which that response has
        // never contained, so the cold-chain table was permanently empty no
        // matter what data existed. Corrected to the real keys.
        setHistory(json.data.readings || []);
        setStats(json.data.summary || null);
      }
    } catch (e) {
      console.error('Failed to load cold-chain history:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimLoading(true);
    setSimMsg('');
    try {
      const res = await fetch('/api/iot/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: simBatchId,
          sensorId: simSensorId,
          hours: parseInt(simHours) || 24,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSimMsg(`✓ Generated ${json.data.count} simulated IoT readings for ${simBatchId}`);
        fetchHistory(simBatchId);
      } else {
        setSimMsg(json.error?.message || 'Simulation failed');
      }
    } catch (err: any) {
      setSimMsg(err.message || 'Error running simulator');
    } finally {
      setSimLoading(false);
    }
  };

  const handlePostReading = async (e: React.FormEvent) => {
    e.preventDefault();
    setPostingReading(true);
    try {
      const res = await fetch('/api/iot/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          sensorId: simSensorId,
          temperature: parseFloat(manualTemp),
          humidity: parseFloat(manualHumidity),
          location: manualLocation,
        }),
      });
      const json = await res.json();
      if (json.success) {
        fetchHistory();
        setSimMsg(`✓ Reading posted: ${manualTemp}°C ${json.data.fraudAlert ? '⚠️ TEMPERATURE BREACH DETECTED' : ''}`);
      } else {
        setSimMsg(json.error?.message || 'Failed to post reading');
      }
    } catch (err: any) {
      setSimMsg(err.message || 'Error posting reading');
    } finally {
      setPostingReading(false);
    }
  };

  const getTempColor = (temp: number) => {
    if (temp > 20) return 'text-red-600 bg-red-50';
    if (temp > 15) return 'text-amber-600 bg-amber-50';
    return 'text-[#16a34a] bg-green-50';
  };

  return (
    <DashboardLayout title="Transporter Dashboard">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cold-Chain Readings</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{stats?.totalReadings ?? history.length}</p>
            {/* "IoT Sensor Active" was unconditional. The API splits readings
                into sensor-reported and simulated, so the count of real
                readings is known — report it rather than asserting a live
                sensor exists. */}
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              {stats ? `${stats.realReadings} from sensors` : 'No readings yet'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl">🌡️</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Temperature</p>
            {/* The summary nests temperature under `temperature`, not at the
                top level as this page previously assumed. */}
            <p className="text-2xl font-extrabold text-[#16a34a] mt-1">
              {stats?.temperature ? `${stats.temperature.avg.toFixed(1)}°C` : '—'}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">Target: 10–15°C</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl">❄️</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Temperature Breaches</p>
            <p className={`text-2xl font-extrabold mt-1 ${(stats?.temperature?.breaches ?? 0) > 0 ? 'text-red-600' : 'text-[#16a34a]'}`}>
              {stats?.temperature?.breaches ?? 0}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              {stats?.temperature ? `${stats.temperature.breachPercent}% breach rate` : 'No data'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-xl">⚠️</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cold-Chain Range</p>
            <p className="text-sm font-extrabold text-[#1a1a1a] mt-1">
              {stats?.temperature ? `${stats.temperature.min.toFixed(1)}°C – ${stats.temperature.max.toFixed(1)}°C` : '—'}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">Min / Max observed</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl">📊</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <div className="lg:col-span-1 space-y-4">
          {/* Batch Lookup */}
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-[#1a1a1a]">🔍 Load Cold-Chain History</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="flex-1 text-xs font-mono font-bold text-[#16a34a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                placeholder="AGR-2026-UK-284701"
              />
              <button
                onClick={() => fetchHistory()}
                disabled={loading}
                className="px-3 py-2 bg-[#16a34a] text-white text-xs font-bold rounded-xl hover:bg-green-700"
              >
                {loading ? '...' : 'Load'}
              </button>
            </div>
          </div>

          {/* Manual Reading */}
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-[#1a1a1a]">📡 Post Manual IoT Reading</h2>
            <form onSubmit={handlePostReading} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Temp (°C)</label>
                  <input type="number" step="0.1" value={manualTemp} onChange={(e) => setManualTemp(e.target.value)}
                    className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#16a34a]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Humidity (%)</label>
                  <input type="number" step="0.1" value={manualHumidity} onChange={(e) => setManualHumidity(e.target.value)}
                    className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#16a34a]" />
                </div>
              </div>
              <input type="text" value={manualLocation} onChange={(e) => setManualLocation(e.target.value)}
                placeholder="Current location"
                className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#16a34a]" />
              <button type="submit" disabled={postingReading}
                className="w-full py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700">
                {postingReading ? 'Posting...' : '📡 Submit Reading'}
              </button>
            </form>
          </div>

          {/* IoT Simulator */}
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-[#1a1a1a]">🔬 Simulate Cold-Chain Data</h2>
            <form onSubmit={handleSimulate} className="space-y-2">
              <input type="text" value={simBatchId} onChange={(e) => setSimBatchId(e.target.value)}
                placeholder="Batch code"
                className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none" />
              <input type="text" value={simSensorId} onChange={(e) => setSimSensorId(e.target.value)}
                placeholder="Sensor ID"
                className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none" />
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase">Duration (hours)</label>
                <input type="number" value={simHours} onChange={(e) => setSimHours(e.target.value)}
                  className="w-full text-xs p-2 bg-[#FAFAF7] border border-gray-200 rounded-lg focus:outline-none" />
              </div>
              <button type="submit" disabled={simLoading}
                className="w-full py-2 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700">
                {simLoading ? 'Simulating...' : '🔬 Run Simulator'}
              </button>
            </form>
            {simMsg && (
              <p className={`text-xs font-semibold ${simMsg.includes('⚠️') ? 'text-red-600' : 'text-[#16a34a]'}`}>{simMsg}</p>
            )}
          </div>
        </div>

        {/* Temperature Log Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            {/* This heading said "Real-time" and the table had no
                simulated/real column, while /api/iot/simulator writes generated
                readings into the same table with isSimulated set. The
                simulator marks every row it writes, but that mark was dropped
                here, so generated temperatures could be read as sensor
                telemetry. The counts below come from the API's own split. */}
            <h3 className="text-sm font-bold text-[#1a1a1a]">🌡️ Cold-Chain Log</h3>
            <div className="flex items-center gap-3 text-xs">
              {stats && stats.simulatedReadings > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold text-[11px]">
                  {stats.simulatedReadings} simulated
                </span>
              )}
              <span className="text-gray-500">
                {stats ? `${stats.realReadings} sensor / ${history.length} total` : `${history.length} readings`}
              </span>
            </div>
          </div>
          <div className="overflow-y-auto max-h-[500px]">
            <table className="w-full text-left text-xs text-[#1a1a1a]">
              <thead className="bg-[#FAFAF7] text-gray-500 font-semibold border-b border-gray-200 text-[11px] uppercase sticky top-0">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Sensor</th>
                  <th className="py-3 px-4">Temp</th>
                  <th className="py-3 px-4">Humidity</th>
                  <th className="py-3 px-4">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400 text-xs">No IoT readings found. Try loading a batch or running the simulator.</td></tr>
                ) : (
                  history.map((log, idx) => (
                    <tr key={log.id || idx} className={log.isSimulated ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-gray-50'}>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-gray-500">
                        {new Date(log.timestamp).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-blue-600">
                        {log.sensorId || '—'}
                        {log.isSimulated && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold text-[9px] uppercase">
                            Simulated
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full font-extrabold text-[11px] ${getTempColor(log.temperature)}`}>
                          {log.temperature.toFixed(1)}°C
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-600">{log.humidity != null ? `${log.humidity.toFixed(1)}%` : '—'}</td>
                      <td className="py-2.5 px-4 text-gray-600 truncate max-w-32">{log.location}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
