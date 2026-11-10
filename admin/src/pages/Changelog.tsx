import { useEffect } from 'react';
import { ArrowLeft, Sparkles, Wrench, Shield } from 'lucide-react';
import { Link } from 'react-router';
import { logoUrl } from '../assets';

interface ReleaseItem {
  version: string;
  date: string;
  title: string;
  summary: string;
  categories: {
    label: string;
    icon: typeof Sparkles;
    items: string[];
  }[];
}

const releases: ReleaseItem[] = [
  {
    version: '26w41a',
    date: '2026年10月11日',
    title: '营养信息修正与 Android 内测包',
    summary: 'Android 预览包已生成，服务端已更新；真实设备验收仍在进行。',
    categories: [
      {
        label: '饮食记录', icon: Sparkles,
        items: [
          '区分未知营养与真实零值，保留热量小数，完善营养来源和审核状态。',
          '完善多餐共做与核心流程恢复，减少重试时重复扣减库存或重复记录饮食。',
        ],
      },
      {
        label: '内测安装包', icon: Wrench,
        items: [
          '26w41a 已通过包名、版本和持久签名检查，覆盖安装仍待真机验证。',
          '应用内更新功能已实现，下载来源与发布清单尚未配置，当前不能通过该入口下载安装包。',
        ],
      },
      {
        label: '账户恢复', icon: Shield,
        items: [
          '新增通过已验证绑定手机恢复密码的流程；线上短信服务尚未启用，暂不可用于真实找回。',
          '密码重设后旧会话失效；邮箱恢复暂不支持。',
        ],
      },
    ],
  },
];

export default function Changelog() {
  useEffect(() => {
    window.scrollTo(0, 0);
    window.document.title = '更新日志｜食光烙记';
  }, []);

  return (
    <div className="min-h-screen bg-[#fdf8f0] text-[#283b2e] font-sans">
      <header className="border-b border-[#e4ddcf] bg-[#fdf8f0]/90 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#6d685c] hover:text-[#283b2e] transition">
            <ArrowLeft size={16} /> 返回首页
          </Link>
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="食光烙记" className="h-7 w-7 object-contain" />
            <span className="font-semibold text-base tracking-wider">食光烙记</span>
          </div>
          <Link to="/journal" className="text-sm text-[#6d685c] hover:text-[#8a4b30] transition">
            食光手记 →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <div className="border-b border-[#e4ddcf] pb-8 mb-12">
          <p className="text-xs font-semibold tracking-widest text-[#666c58] flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#a95c3e]" />
            FOOTPRINTS & CHANGELOG
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-serif font-medium text-[#283b2e]">
            版本足迹 · 更新日志
          </h1>
          <p className="mt-4 text-base text-[#6d685c] leading-relaxed">
            记录每一次思考、打磨与迭代。食光烙记正在持续生长中，感谢你陪我们一起把日常做好。
          </p>
        </div>

        <div className="space-y-12">
          {releases.map((rel, idx) => (
            <article
              key={rel.version}
              className="relative pl-6 sm:pl-8 border-l-2 border-[#e4ddcf] pb-2 last:pb-0"
            >
              {/* Timeline marker */}
              <div
                className={`absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-[#fdf8f0] ${
                  idx === 0 ? 'bg-[#344e39] ring-4 ring-[#344e39]/10' : 'bg-[#c6cdba]'
                }`}
              />

              <div className="flex flex-wrap items-baseline gap-3 mb-2">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-[#344e39]/10 text-[#344e39]">
                  {rel.version}
                </span>
                <span className="text-xs text-[#8d887c]">{rel.date}</span>
                {idx === 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#a95c3e]/10 text-[#a95c3e]">
                    当前最新
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-serif font-medium text-[#283b2e] mt-2">
                {rel.title}
              </h2>

              <p className="mt-2 text-sm text-[#6d685c] leading-relaxed">
                {rel.summary}
              </p>

              <div className="mt-6 space-y-5 bg-[#fffdf8] border border-[#e4ddcf] rounded-2xl p-5 sm:p-6 shadow-[0_4px_20px_#6c4f2f05]">
                {rel.categories.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <div key={cat.label} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#647055]">
                        <Icon size={14} className="text-[#a95c3e]" />
                        <span>{cat.label}</span>
                      </div>
                      <ul className="space-y-1.5 pl-5 list-disc text-sm text-[#4d5644] leading-relaxed marker:text-[#a95c3e]">
                        {cat.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-[#e4ddcf] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8d887c]">
          <p>© {new Date().getFullYear()} 食光烙记 · 认真吃饭，慢慢迭代</p>
          <div className="flex items-center gap-4">
            <Link to="/" className="hover:text-[#283b2e] underline underline-offset-4">返回首页</Link>
            <Link to="/journal" className="hover:text-[#283b2e] underline underline-offset-4">食光手记</Link>
            <a href="https://github.com/AdlinZ/DietDigiDose" target="_blank" rel="noreferrer" className="hover:text-[#283b2e] underline underline-offset-4">GitHub 仓库 ↗</a>
          </div>
        </div>
      </main>
    </div>
  );
}
