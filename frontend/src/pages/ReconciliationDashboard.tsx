// pages/ReconciliationDashboard.tsx - Analytics and KPI dashboard
import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { dashboardAPI } from '../api';
import { DashboardSummary } from '../types';
import StatusBadge from '../components/StatusBadge';

const tableHeaderClass = 'px-4 py-2 text-left text-sm font-semibold text-[#003F72]';
const numericTableHeaderClass = 'px-4 py-2 text-right text-sm font-semibold text-[#003F72]';

/**
 * ReconciliationDashboard Component
 * Displays KPI metrics, wastage tracking, and TM turnaround times
 * Critical visualization: ACE Limit (1%) wastage threshold
 */
const ReconciliationDashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetchDashboard();
  }, [days]);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const data = await dashboardAPI.getSummary(days);
      setDashboardData(data);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#003F72]"></div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="text-center text-gray-500">
        Failed to load dashboard data
      </div>
    );
  }

  // Prepare data for wastage chart
  const wastageChartData = dashboardData.wastage_records.map((record) => ({
    name: record.supply_id,
    wastage: record.wastage_percentage,
    limit: 1.0,
  }));

  // Prepare data for turnaround chart (only delivered items)
  const turnaroundChartData = dashboardData.turnaround_records
    .filter((r) => r.turnaround_hours !== null)
    .slice(0, 10)
    .map((record) => ({
      name: record.tm_number,
      hours: record.turnaround_hours || 0,
    }));

  // Status distribution data
  const statusData = [
    { name: 'Pending', value: dashboardData.pending_count },
    { name: 'Approved', value: dashboardData.validated_count },
    { name: 'Dispatched', value: dashboardData.dispatched_count },
    { name: 'Reconciled', value: dashboardData.reconciled_count },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-800">
            Reconciliation Dashboard
          </h1>
          <p className="text-gray-600">Real-time KPI tracking & analytics</p>
        </div>

        <div>
          <label className="text-sm font-semibold text-gray-700 mr-2">
            Analyze Last:
          </label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <div className="text-gray-600 text-sm font-semibold">Total Requisitions</div>
          <div className="text-4xl font-bold text-[#003F72] mt-2">
            {dashboardData.total_requisitions}
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <div className="text-gray-600 text-sm font-semibold">Avg Wastage %</div>
          <div
            className={`text-4xl font-bold mt-2 ${
              dashboardData.average_wastage_percentage > 1
                ? 'text-red-600'
                : 'text-green-600'
            }`}
          >
            {dashboardData.average_wastage_percentage.toFixed(2)}%
          </div>
          <p className="text-xs text-gray-500 mt-2">ACE Limit: 1.0%</p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <div className="text-gray-600 text-sm font-semibold">ACE Violations</div>
          <div
            className={`text-4xl font-bold mt-2 ${
              dashboardData.violation_count > 0 ? 'text-red-600' : 'text-green-600'
            }`}
          >
            {dashboardData.violation_count}
          </div>
          <p className="text-xs text-gray-500 mt-2">Exceed 1% limit</p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <div className="text-gray-600 text-sm font-semibold">Status Breakdown</div>
          <div className="mt-3 space-y-2 text-sm">
            {statusData.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3">
                <span className="text-gray-600">{item.name}</span>
                <span className="font-semibold text-gray-900">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        {/* Wastage Chart */}
        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Wastage Analysis (ACE Limit: 1%)
          </h2>
          {wastageChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={wastageChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Wastage %', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <ReferenceLine
                  y={1}
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  label={{ value: 'ACE Limit (1%)', position: 'right', fill: '#ef4444' }}
                />
                <Bar dataKey="wastage" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-500">
              No data available
            </div>
          )}
        </div>

        {/* Turnaround Time Chart */}
        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            TM Turnaround Time (Recent)
          </h2>
          {turnaroundChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={turnaroundChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="hours"
                  stroke="#003F72"
                  dot={{ fill: '#003F72' }}
                  strokeWidth={2}
                  name="Turnaround (hrs)"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-500">
              No delivery data available
            </div>
          )}
        </div>
      </div>

      {/* Violations Table */}
      {dashboardData.violation_count > 0 && (
        <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            ACE Limit Violations
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-red-50 border-b">
                <tr>
                  <th className={tableHeaderClass}>Supply ID</th>
                  <th className={numericTableHeaderClass}>Requested</th>
                  <th className={numericTableHeaderClass}>Dispatched</th>
                  <th className={numericTableHeaderClass}>Wastage %</th>
                  <th className={tableHeaderClass}>TM Numbers</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData.wastage_records
                  .filter((r) => r.exceeds_ace_limit)
                  .map((record) => (
                    <tr key={record.supply_id} className="border-b transition-colors duration-150 ease-out hover:bg-red-50">
                      <td className="px-4 py-3 font-mono text-sm">
                        {record.supply_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {record.requested_qty.toFixed(2)} m3
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {record.actual_dispatched_qty.toFixed(2)} m3
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-red-600">
                        {record.wastage_percentage.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {record.tm_numbers.join(', ')}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Requisitions Table */}
      <div className="rounded-lg bg-white p-6 shadow transition-shadow duration-200 ease-out hover:shadow-md">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          All Requisitions ({dashboardData.wastage_records.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className={tableHeaderClass}>Supply ID</th>
                <th className={numericTableHeaderClass}>Requested</th>
                <th className={numericTableHeaderClass}>Dispatched</th>
                <th className={numericTableHeaderClass}>Wastage</th>
                <th className={numericTableHeaderClass}>Wastage %</th>
                <th className={tableHeaderClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {dashboardData.wastage_records.map((record) => (
                <tr
                  key={record.supply_id}
                  className={`border-b ${
                    record.exceeds_ace_limit ? 'bg-red-50' : 'hover:bg-blue-50/45'
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-sm">{record.supply_id}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {record.requested_qty.toFixed(2)} m3
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {record.actual_dispatched_qty.toFixed(2)} m3
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {record.wastage_qty.toFixed(2)} m3
                  </td>
                  <td
                    className={`px-4 py-3 text-sm text-right font-semibold ${
                      record.exceeds_ace_limit
                        ? 'text-red-600'
                        : 'text-green-600'
                    }`}
                  >
                    {record.wastage_percentage.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={record.exceeds_ace_limit ? 'VIOLATION' : 'OK'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationDashboard;
