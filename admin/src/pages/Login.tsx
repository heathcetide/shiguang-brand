import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, UserRound } from 'lucide-react';
import api from '../services/api';
import { AuthLayout } from '../components/admin/AuthLayout';
import { shouldForceAdminPasswordChange } from '../services/adminSession';

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
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    document.title = '管理员登录｜拾味日常';
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
      navigate(shouldForceAdminPasswordChange(userRes.data.must_change_password) ? '/change-password' : '/admin');
    } catch (err: any) {
      setError(err.response?.data?.error || '登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="欢迎回来" description="管理后台登录，开始今天的有序日常。">
      {error && <div id="login-error" role="alert" className="admin-auth-feedback"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></div>}
      {location.state?.passwordChanged && !error && <div role="status" className="admin-auth-feedback is-success"><CheckCircle2 size={16} aria-hidden="true" /><span>密码已更新，请使用新密码登录。</span></div>}
      <form onSubmit={handleLogin} className="admin-auth-form" aria-busy={loading} aria-describedby={error ? 'login-error' : undefined}>
        <div className="admin-auth-field">
          <label htmlFor="admin-username">管理员账号</label>
          <div className="admin-auth-input">
            <UserRound aria-hidden="true" />
            <input id="admin-username" name="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="请输入管理员账号" disabled={loading} required />
          </div>
        </div>
        <div className="admin-auth-field">
          <label htmlFor="admin-password">登录密码</label>
          <div className="admin-auth-input">
            <KeyRound aria-hidden="true" />
            <input id="admin-password" name="password" type={passwordVisible ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="请输入登录密码" disabled={loading} required />
            <button type="button" className="admin-auth-password-toggle" aria-label={passwordVisible ? '隐藏密码' : '显示密码'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(visible => !visible)}>{passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
          </div>
        </div>
        <button type="submit" disabled={loading} className="admin-auth-submit">
          {loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? '登录中...' : '登录管理控制台'}
          {!loading && <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </form>
    </AuthLayout>
  );
}
