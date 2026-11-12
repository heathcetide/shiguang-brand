import { Image, Smartphone } from 'lucide-react';
import { useLocation } from 'react-router';
import { EmptyState, PageHeader, Section, StatusBadge } from '../components/admin';

export default function AuthServicePlaceholder() {
  const isCaptcha = useLocation().pathname.endsWith('/captcha');
  const Icon = isCaptcha ? Image : Smartphone;
  const title = isCaptcha ? '图形验证码认证' : '号码认证服务';

  return (
    <div className="admin-stack">
      <PageHeader
        title={title}
        description="模块入口和路由已经预留，本期尚未接入供应商与业务流程。"
      />
      <Section title="接入状态" icon={<Icon size={18} />}>
        <EmptyState>
          后续可以沿用认证主体、挑战、事件和每日用量模型扩展。
        </EmptyState>
        <div className="mt-4">
          <StatusBadge tone="warning">尚未接入</StatusBadge>
        </div>
      </Section>
    </div>
  );
}
