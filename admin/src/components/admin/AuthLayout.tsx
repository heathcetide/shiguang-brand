import type { ReactNode } from 'react';
import { CookingPot, ShieldCheck, Sprout } from 'lucide-react';
import { logoUrl } from '../../assets';
import './auth.css';

export function AuthLayout({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <main className="admin-auth">
    <section className="admin-auth-story" aria-label="拾味日常管理控制台">
      <div className="admin-auth-brand">
        <img src={logoUrl} alt="" />
        <div>拾味日常<small>SHIWEI DAILY · ADMIN</small></div>
      </div>
      <div className="admin-auth-intro">
        <span className="admin-auth-eyebrow">运营控制台</span>
        <h2>内容、用户与数据，<br />集中在一处打理。</h2>
        <p>沿用清晰的信息层级与低干扰界面，把日常审核与配置做得更稳。</p>
      </div>
      <div className="admin-auth-art" aria-hidden="true">
        <div className="admin-auth-arch" />
        <div className="admin-auth-plate"><img src={logoUrl} alt="" /></div>
        <span className="admin-auth-art-note"><Sprout size={16} />认真对待每一餐</span>
        <span className="admin-auth-art-stamp"><CookingPot size={21} />拾 · 味</span>
      </div>
      <p className="admin-auth-story-footer">内容管理 <span>／</span> 用户运营 <span>／</span> 数据洞察</p>
    </section>
    <section className="admin-auth-content" aria-labelledby="admin-auth-title">
      <div className="admin-auth-mobile-brand"><img src={logoUrl} alt="" /><span>拾味日常<small>管理控制台</small></span></div>
      <div className="admin-auth-form-wrap">
        <span className="admin-auth-access"><ShieldCheck size={15} aria-hidden="true" />仅限授权管理员</span>
        <header className="admin-auth-heading">
          <h1 id="admin-auth-title">{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <p className="admin-auth-security"><ShieldCheck size={14} aria-hidden="true" />请妥善保管管理凭据，操作将按权限记录。</p>
      </div>
      <footer className="admin-auth-footer">拾味日常 <span>·</span> 管理控制台</footer>
    </section>
  </main>;
}
