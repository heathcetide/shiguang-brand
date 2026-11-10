import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import api from '../services/api';
import { logoUrl } from '../assets';

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
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt p-4">
      <div className="w-full max-w-md rounded-[32px] bg-white p-8 shadow-lg">
        <div className="mb-7 text-center">
          <img src={logoUrl} alt="食光烙记" className="mx-auto mb-4 h-20 w-20 object-contain" />
          <h1 className="text-2xl font-bold text-text-main">首次登录安全设置</h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            当前管理员账号仍在使用初始密码，请设置新密码后继续进入管理端。
          </p>
        </div>

        {error ? <div className="mb-5 rounded-2xl bg-red-50 p-3 text-center text-sm text-red-600">{error}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField label="当前密码" value={currentPassword} onChange={setCurrentPassword} />
          <PasswordField label="新密码" value={newPassword} onChange={setNewPassword} />
          <PasswordField label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} />
          <p className="text-xs text-text-muted">新密码至少 6 位，并同时包含字母和数字。</p>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            {loading ? '正在修改...' : '修改密码并重新登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-text-main">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        autoComplete={label === '当前密码' ? 'current-password' : 'new-password'}
        className="w-full rounded-2xl border border-gray-200 px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}
