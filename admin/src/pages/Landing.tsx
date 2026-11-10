import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, Menu, X } from 'lucide-react';
import { logoUrl } from '../assets';
import api from '../services/api';
import './Landing.css';

const appUrl = 'https://dietdigidose.top/app/';
const betaUrl = 'mailto:adlinzhang@gmail.com?subject=%E9%A3%9F%E5%85%89%E7%83%99%E8%AE%B0%E5%86%85%E6%B5%8B%E7%94%B3%E8%AF%B7';

interface NavItem {
  href: string;
  label: string;
  isRoute?: boolean;
}

const navigation: NavItem[] = [
  { href: '#daily', label: '一餐的日常' },
  { href: '#inside', label: '看看食光' },
  { href: '/journal', label: '食光手记', isRoute: true },
  { href: '/changelog', label: '更新日志', isRoute: true },
  { href: '#start', label: '开始使用' },
];

const dailySteps = [
  { time: '买菜回来', title: '先记下，家里有什么。', description: '把买来的食材放进保鲜库，记好数量和存放方式。下次买菜前，先看看家里还剩什么。', note: '食材库存 · 采购清单' },
  { time: '准备晚饭', title: '用手边的食材，找一道想吃的菜。', description: '翻翻菜谱，看看原料和做法。缺的食材加入采购单，想做的菜留进烹饪队列。', note: '食谱查找 · 备料清单 · 烹饪队列' },
  { time: '吃过以后', title: '今天这一餐，也留个记录。', description: '做了什么、吃了多少，分别记清楚。以后回头看，知道自己这些天是怎样吃饭的。', note: '饮食记录 · 营养参考' },
];

const productViews = [
  { label: '备料清单', src: '/landing/recipe-preparation.png', alt: '真实备料清单：番茄、鸡蛋、小葱和调味料，包含用量与准备勾选项', caption: '网页版实截' },
  { label: '食谱详情', src: '/landing/recipe-detail.webp', alt: 'Gemini 生成的番茄炒蛋食谱详情示意图', caption: 'Gemini 生成示意图，以实际界面为准' },
];

const questions = [
  ['现在可以在哪里使用？', '可以先打开网页版，在手机或电脑浏览器里查看公开食谱。保存库存、饮食记录等个人内容需要登录。移动端安装包仍在内测中，暂未在这里提供公开下载。'],
  ['食语助手能帮我做什么？', '食语是食光里的 AI 辅助入口，可以尝试询问烹饪问题。自动配餐、工具执行等能力仍在验证中，回答需要结合实际情况核对；重要操作以页面确认结果为准。'],
  ['食谱里的营养数字准确吗？', '营养信息是基于原料与用量的估算。资料不完整的食谱会标明待补全，不应当作精确测量或医疗建议。'],
  ['怎么参加内测或反馈问题？', '可以通过下方邮件入口申请内测，告诉我们你的设备和最想试用的功能。使用中遇到的问题，也可以在 App 的反馈入口提交并查看回复。'],
];

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeProductView, setActiveProductView] = useState(0);
  const productView = productViews[activeProductView];
  const [filing, setFiling] = useState({ enabled: false, text: '', url: '' });

  useEffect(() => {
    let active = true;
    api.get('/site-settings')
      .then(({ data }) => { if (active && data?.filing) setFiling(data.filing); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.title = '食光烙记｜把日常，做成好好的一餐';
  }, []);

  return (
    <div className="landing min-h-screen">
      <a className="landing-skip" href="#main-content">跳到正文</a>
      <header className="landing-header">
        <div className="landing-container flex items-center justify-between gap-4 py-5">
          <Link to="/" className="flex items-center gap-2.5" aria-label="食光烙记首页">
            <img src={logoUrl} alt="" width="38" height="38" />
            <span className="landing-brand">食光烙记<small>把日子过进一餐一饭</small></span>
          </Link>
          <nav aria-label="主导航" className="hidden items-center gap-6 text-sm lg:flex">
            {navigation.map((item) =>
              item.isRoute ? (
                <Link to={item.href} key={item.href}>{item.label}</Link>
              ) : (
                <a href={item.href} key={item.href}>{item.label}</a>
              )
            )}
          </nav>
          <div className="flex items-center gap-4">
            <a href={appUrl} className="landing-header-entry">打开食光 <ArrowRight size={16} aria-hidden="true" /></a>
            <button
              type="button"
              className="landing-menu-button lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              aria-label={mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'}
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav id="mobile-navigation" aria-label="手机导航" className="landing-container flex flex-col gap-1 pb-4 lg:hidden">
            {navigation.map((item) =>
              item.isRoute ? (
                <Link
                  className="py-3"
                  to={item.href}
                  key={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ) : (
                <a
                  className="py-3"
                  href={item.href}
                  key={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              )
            )}
          </nav>
        )}
      </header>

      <main id="main-content">
        <section className="landing-container landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero-copy">
            <div className="flex flex-wrap items-center gap-3">
              <p className="landing-eyebrow"><span />给认真吃饭的每一天</p>
              <Link to="/changelog" className="landing-badge-link" aria-label="查看最新版本更新日志">
                <span className="landing-badge-pulse" />
                26w41a 内测版本 · 查看足迹 ↗
              </Link>
            </div>
            <h1 id="hero-title">把手边的食材，<br />做成<span>今天的一餐。</span></h1>
            <p className="landing-intro">记下买来的食材，找到能做的菜，<br className="hidden sm:block" />也留住每天吃过的饭。</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-5">
              <a href={appUrl} className="landing-button">打开网页版 <ArrowRight size={18} aria-hidden="true" /></a>
              <a href="#daily" className="landing-text-link">看看怎么用 <ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <p className="landing-access-note">内测进行中 · 可先浏览食谱，登录后保存个人记录</p>
          </div>
          <figure className="landing-dinner">
            <div className="landing-photo-wrap"><img src="/landing/meal-bowl.webp" alt="自然光下的洋葱肥牛饭，盛在陶碗里，旁边放着筷子" width="600" height="365" fetchPriority="high" /></div>
            <figcaption><div><span className="landing-photo-label">餐桌一角 · AI 示意图</span><strong>洋葱肥牛饭</strong></div><p>一碗热饭，<br />把今天安顿好。</p></figcaption>
          </figure>
        </section>

        <div className="landing-container landing-section-rule"><span>从厨房，到餐桌</span><span>食材 / 菜谱 / 饮食记录</span></div>

        <section id="daily" className="landing-container landing-daily" aria-labelledby="daily-title">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">01 / 一餐的日常</p>
            <h2 id="daily-title">晚饭这件小事，<br />从打开冰箱开始。</h2>
            <p>不一定要做一桌大菜。<br />把手边的食材用好，一顿家常饭就很好。</p>
          </div>
          <ol className="landing-steps">
            {dailySteps.map((step, index) => <li key={step.time}>
              <span className="landing-step-number">0{index + 1}</span>
              <div><p className="landing-step-time">{step.time}</p><h3>{step.title}</h3><p className="landing-step-description">{step.description}</p><p className="landing-step-note">{step.note}</p></div>
            </li>)}
          </ol>
        </section>

        <section id="inside" className="landing-inside" aria-labelledby="inside-title">
          <div className="landing-container landing-product-grid">
            <figure className="landing-product-figure">
              <div className="landing-product-switch" role="group" aria-label="选择产品截图">
                {productViews.map((view, index) => <button key={view.src} type="button" aria-pressed={activeProductView === index} onClick={() => setActiveProductView(index)}>{view.label}</button>)}
              </div>
              <a className="landing-screenshot-link" href={productView.src} target="_blank" rel="noreferrer" aria-label={`查看${productView.label}大图（在新标签页打开）`}>
                <img src={productView.src} alt={productView.alt} width="390" height="844" loading="lazy" />
              </a>
              <figcaption>{productView.caption} · {productView.label}<br /><span>点击图片，查看大图 ↗</span></figcaption>
            </figure>
            <div className="landing-product-copy">
              <p className="landing-eyebrow">02 / 看看食光</p>
              <h2 id="inside-title">先看看做法，<br />再决定今晚吃什么。</h2>
              <p className="landing-product-intro">从一道熟悉的番茄炒蛋开始。原料、步骤和饮食记录，都有可以慢慢翻看的地方。</p>
              <dl className="landing-product-notes">
                <div><dt>备料时，有清单</dt><dd>查看原料与用量，逐项标记已经备好的食材。</dd></div>
                <div><dt>想做的，先留着</dt><dd>加入烹饪队列，等准备好再开始。</dd></div>
                <div><dt>营养数字，有说明</dt><dd>区分估算与待补全信息，查看称量条件和来源。</dd></div>
              </dl>
              <a href={appUrl} className="landing-text-link">去食光里翻翻菜谱 <ArrowRight size={18} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section id="journal" className="landing-container landing-journal" aria-labelledby="journal-title">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">03 / 食光手记</p>
            <h2 id="journal-title">把日子，<br />过进一餐一饭。</h2>
            <p>做这款工具的初心、设计取舍与厨房随笔。<br />在安静的文字里，分享我们对生活与做饭的思考。</p>
            <div className="mt-7">
              <Link to="/journal" className="landing-text-link">
                阅读全部食光手记 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="landing-journal-cards">
            <Link to="/journal?id=onion-in-the-fridge" className="landing-journal-card">
              <span className="landing-journal-tag">产品初心</span>
              <h3>从冰箱深处烂掉的半个洋葱说起</h3>
              <p>为什么市面上有那么多菜谱软件，我们仍然想做一个以你手边食材为中心的工具？</p>
              <div className="landing-journal-footer">
                <span>4 分钟阅读</span>
                <span className="landing-journal-more">阅读随笔 →</span>
              </div>
            </Link>
            <Link to="/journal?id=honest-nutrition-estimates" className="landing-journal-card">
              <span className="landing-journal-tag">设计与科学</span>
              <h3>关于营养数据：我们为什么坚持“估算”</h3>
              <p>拒绝虚假精确。在充满变量的日常厨房里，如何给出一份真正坦诚的营养参考？</p>
              <div className="landing-journal-footer">
                <span>5 分钟阅读</span>
                <span className="landing-journal-more">阅读随笔 →</span>
              </div>
            </Link>
          </div>
        </section>

        <section id="start" className="landing-container landing-start" aria-labelledby="start-title">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">04 / 开始使用</p>
            <h2 id="start-title">从下一顿饭，<br />试着用起来。</h2>
            <p>食光烙记正在内测。<br />欢迎来用，也欢迎告诉我们哪里还不顺手。</p>
            <div className="mt-7"><a href={appUrl} className="landing-button">打开网页版 <ArrowRight size={18} aria-hidden="true" /></a></div>
            <a href={betaUrl} className="landing-email-link">想试用移动端？邮件申请内测 ↗</a>
          </div>
          <div className="landing-faq">
            {questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
          </div>
        </section>
        <div className="landing-container landing-endnote"><span>食光烙记</span><p>好好吃饭，慢慢记录。</p><a href="#hero-title" aria-label="回到首页顶部">回到顶部 ↑</a></div>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="flex flex-col justify-between gap-5 sm:flex-row">
            <p>© {new Date().getFullYear()} 食光烙记 · DietDigiDose</p>
            <nav aria-label="页脚导航" className="flex flex-wrap gap-x-6 gap-y-3">
              <Link to="/journal">食光手记</Link>
              <Link to="/changelog">更新日志</Link>
              <Link to="/privacy">隐私政策</Link>
              <Link to="/terms">用户协议</Link>
              <a href="https://github.com/AdlinZ/DietDigiDose" target="_blank" rel="noreferrer">开源仓库 ↗</a>
              <Link to="/login">管理后台</Link>
            </nav>
          </div>
          <div className="mt-5 flex flex-wrap justify-between gap-3">
            {filing.enabled && filing.text ? (filing.url ? <a href={filing.url} target="_blank" rel="noreferrer">{filing.text}</a> : <span>{filing.text}</span>) : <span />}
            <p>餐食与食谱详情示意图：Gemini 生成 · 备料清单为实际截图</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
