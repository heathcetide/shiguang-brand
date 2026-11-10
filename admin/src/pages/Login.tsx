import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import api from '../services/api';
import { logoUrl } from '../assets';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const reason = new URLSearchParams(location.search).get('reason');
  const [error, setError] = useState(
    reason === 'insufficient-role'
      ? '当前账号已无管理权限，请使用管理员账号登录'
      : reason === 'unauthenticated'
        ? '登录会话已失效，请重新登录'
        : '',
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = '管理员登录｜食光烙记';
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', {
        identifier: username.trim(),
        password,
      });
      
      // Admin verification
      const userRes = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${response.data.token}` }
      });

      if (userRes.data.role !== 'admin') {
        setError('您没有管理权限');
        return;
      }

      localStorage.setItem('adminToken', response.data.token);
      navigate(userRes.data.must_change_password ? '/change-password' : '/admin');
    } catch (err: any) {
      setError(err.response?.data?.error || '登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-alt font-sans">
      <div className="bg-background p-10 rounded-[32px] shadow-lg w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={logoUrl}
            alt="食光烙记"
            className="mx-auto mb-4 h-24 w-24 object-contain"
          />
          <h1 className="text-3xl font-bold text-primary mb-2">食光烙记</h1>
          <p className="text-text-muted">管理后台登录</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-500 p-3 rounded-2xl mb-6 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-main mb-2">管理员账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-secondary transition-all"
              placeholder="请输入管理员账号，如 admin"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-main mb-2">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-secondary transition-all"
              placeholder="请输入密码"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-3 rounded-2xl transition-all disabled:opacity-50 mt-4"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
