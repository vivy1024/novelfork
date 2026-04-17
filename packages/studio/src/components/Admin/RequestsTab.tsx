/**
 * 请求历史标签页
 */

import { useState, useEffect } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";

interface RequestLog {
  id: string;
  timestamp: Date;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
}

export function RequestsTab() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    loadLogs();
  }, [limit]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ logs: RequestLog[]; total: number }>(
        `/api/admin/requests?limit=${limit}`
      );
      setLogs(data.logs);
      setTotal(data.total);
    } catch (error) {
      console.error("Failed to load request logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-green-600 dark:text-green-400";
    if (status >= 300 && status < 400) return "text-blue-600 dark:text-blue-400";
    if (status >= 400 && status < 500) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case "GET":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "POST":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "PUT":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "DELETE":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600 dark:text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">请求历史</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            显示最近 {logs.length} 条，共 {total} 条记录
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value={50}>50 条</option>
            <option value={100}>100 条</option>
            <option value={200}>200 条</option>
            <option value={500}>500 条</option>
          </select>
          <button
            onClick={loadLogs}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  时间
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  方法
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  端点
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  耗时
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  用户
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getMethodColor(log.method)}`}>
                      {log.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-mono">
                    {log.endpoint}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`font-semibold ${getStatusColor(log.status)}`}>{log.status}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{log.duration}ms</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{log.userId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {logs.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <FileText size={48} className="mx-auto mb-4 opacity-50" />
          <p>暂无请求记录</p>
        </div>
      )}
    </div>
  );
}
