import { Construction, Image, Smartphone } from 'lucide-react';
import { useLocation } from 'react-router';

export default function AuthServicePlaceholder() {
  const isCaptcha = useLocation().pathname.endsWith('/captcha');
  const Icon = isCaptcha ? Image : Smartphone;
  const title = isCaptcha ? '图形验证码认证' : '号码认证服务';
  return <div className="flex min-h-[60vh] items-center justify-center"><div className="max-w-lg rounded-3xl bg-white p-10 text-center shadow-sm"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon size={30} /></div><h2 className="text-2xl font-bold text-text-main">{title}</h2><p className="mt-3 leading-7 text-text-muted">模块入口和路由已经预留，本期尚未接入供应商与业务流程。后续可以沿用认证主体、挑战、事件和每日用量模型扩展。</p><div className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700"><Construction size={16} />尚未接入</div></div></div>;
}

