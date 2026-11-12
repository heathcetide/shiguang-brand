import { useState } from 'react';
import { AlertCircle, KeyRound, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import api from '../services/api';
import { AuthLayout } from '../components/admin/AuthLayout';
import { ADMIN_PASSWORD_CHANGE_DEFERRED_KEY } from '../services/adminSession';

export default function ChangePassword() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    try {
      setLoading(true);
      await api.post('/auth/change-password', { currentPassword, newPassword });
      localStorage.removeItem('adminToken');
      localStorage.removeItem(ADMIN_PASSWORD_CHANGE_DEFERRED_KEY);
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem(ADMIN_PASSWORD_CHANGE_DEFERRED_KEY, '1');
    navigate('/admin', { replace: true });
  };

  return (
    <AuthLayout title="首次登录安全设置" description="当前管理员账号仍在使用初始密码。建议尽快修改；本地联调也可先跳过，稍后在页脚再次进入。">
      {error && <div id="password-error" role="alert" className="admin-auth-feedback"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="admin-auth-form" aria-busy={loading} aria-describedby={error ? 'password-error' : undefined}>
        <PasswordField label="当前密码" value={currentPassword} onChange={setCurrentPassword} disabled={loading} />
        <PasswordField label="新密码" value={newPassword} onChange={setNewPassword} disabled={loading} />
        <PasswordField label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} disabled={loading} />
        <p className="admin-auth-policy">新密码至少 6 位，并同时包含字母和数字。</p>
        <button type="submit" disabled={loading} className="admin-auth-submit">
          {loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}
          {loading ? '正在修改...' : '修改密码并重新登录'}
        </button>
        <button type="button" disabled={loading} className="admin-auth-secondary" onClick={handleSkip}>
          稍后修改，先进入管理端
        </button>
      </form>
    </AuthLayout>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="admin-auth-field">
      <span>{label}</span>
      <span className="admin-auth-input">
        <KeyRound aria-hidden="true" />
        <input type="password" value={value} onChange={(event) => onChange(event.target.value)} required disabled={disabled} autoComplete={label === '当前密码' ? 'current-password' : 'new-password'} placeholder={`请输入${label}`} />
      </span>
    </label>
  );
}
