import { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { logoUrl } from '../assets';

type LegalKind = 'privacy' | 'terms';

const documents = {
  privacy: {
    title: '隐私政策',
    introduction: '食光烙记运营团队重视您的个人信息和隐私安全。本政策说明我们在您使用食光烙记时，如何收集、使用、保存、共享和保护相关信息，以及您如何管理自己的信息。',
    highlights: ['健康、疾病、用药及过敏信息属于敏感个人信息。', '拒绝提供可选信息不会影响账号、库存和饮食记录等核心功能。', 'AI 建议仅用于日常饮食与健康管理，不替代专业医疗意见。'],
    sections: [
      ['我们处理的信息', '根据您实际使用的功能，我们可能处理账号与安全信息、饮食与厨房记录、健康与偏好信息、社区内容、AI 交互信息、通知偏好及必要的设备日志。我们仅处理实现明确功能所需的信息。'],
      ['设备权限', '相册、相机、麦克风和通知权限仅在您主动使用对应功能时申请。您可以拒绝或随时在设备设置中关闭，关闭后仅对应功能受限。'],
      ['信息的使用', '相关信息用于维护账号、同步记录、提供库存与到期提醒、计算营养参考、完成图片或语音识别、生成个性化建议、保障服务安全及响应您的请求。'],
      ['AI 功能说明', '使用 AI、图片识别或语音识别时，完成请求所需的内容和最少范围上下文可能发送给当前配置的模型服务商处理。模型输出可能不准确，请在采取重要行动前自行核对。'],
      ['共享与公开', '除取得必要授权、履行法定义务或法律另有规定外，我们不会出售或向其他个人信息处理者提供您的个人信息。您主动发布到社区的内容会公开展示，请避免发布敏感信息。'],
      ['保存与安全', '我们按照实现功能、保障安全及法律要求所需的期限保存信息，并采取访问控制、身份认证、加密传输、最小权限和安全审计等措施降低风险。'],
      ['您的权利', '您可以依法查阅、复制、更正、补充或删除自己的信息，也可以撤回授权、清理本地缓存或注销账号。注销操作不可恢复，请提前保存仍需使用的内容。'],
      ['未成年人保护', '不满十四周岁的未成年人应在监护人阅读并同意相关规则后使用服务；其他未成年人建议在监护人指导下使用。'],
      ['政策更新与联系', '如处理目的、信息种类或您的权利发生重大变化，我们会以显著方式告知。若有疑问、意见或投诉，请通过正式发布渠道或应用商店开发者联系方式联系我们。'],
    ],
  },
  terms: {
    title: '用户协议',
    introduction: '欢迎使用食光烙记。本协议是您与食光烙记运营团队之间关于注册账号、访问客户端或网页端以及使用相关服务的约定。',
    highlights: ['食光烙记是日常饮食与健康管理工具，不提供医疗诊断或紧急救助服务。', 'AI、热量和营养数据可能存在误差，重要决定应由专业人员复核。', '您保留原创内容的权利，公开发布前请确认拥有必要授权。'],
    sections: [
      ['协议确认与适用', '当您注册、登录或实际使用服务，即表示您已阅读并同意本协议和《隐私政策》。若您不同意其中任何内容，请停止注册或使用。'],
      ['账号与安全', '您应使用本人可合法使用的信息注册，并妥善保管登录凭据。不得冒用他人身份、买卖、出租、出借或以其他方式转让账号。'],
      ['服务内容', '食光烙记提供食材库存、饮食与健康记录、营养参考、菜谱、购物清单、AI 助手、图片或语音识别及社区互动等功能。具体功能可能随版本调整。'],
      ['健康与安全提示', '服务展示的营养、分量、保质期和健康数据仅供日常记录参考。本服务不构成医疗诊断、治疗、处方或用药调整建议；紧急情况请立即联系当地急救机构。'],
      ['AI 与识别功能', 'AI 生成内容及自动识别具有不确定性，可能出现事实错误、遗漏或误识别。您应在保存记录、采购、食用或采取健康行动前自行核对。'],
      ['用户内容与行为规范', '请确保您发布的文字、图片和其他内容拥有必要权利，不得发布违法、侵权、欺诈、危险或侵犯他人隐私的内容，也不得攻击、干扰或绕过服务安全措施。'],
      ['服务变更与账号终止', '我们会努力保持服务稳定，并可能因维护、安全、产品调整或法律要求变更功能。您可以在应用设置中申请注销账号，注销后相关数据将依法删除或匿名化。'],
      ['责任、更新与争议', '各方按照法律规定及自身过错承担责任。重大协议更新会以显著方式告知；本协议适用中华人民共和国法律，争议应先友好协商，协商不成可依法寻求救济。'],
    ],
  },
} as const;

export default function Legal({ kind }: { kind: LegalKind }) {
  const document = documents[kind];

  useEffect(() => {
    window.scrollTo(0, 0);
    window.document.title = `${document.title}｜食光烙记`;
  }, [document.title]);

  return (
    <main className="min-h-screen bg-[#F7F6F1] px-5 py-8 text-[#26382E] sm:py-12">
      <article className="mx-auto max-w-3xl rounded-[28px] border border-[#DFE8E0] bg-white p-6 shadow-sm sm:p-10">
        <div className="flex items-center justify-between gap-4 border-b border-[#E8EEE8] pb-6">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#35634B] transition hover:bg-[#EFF5EF]"><ArrowLeft size={16} />返回首页</Link>
          <img src={logoUrl} alt="食光烙记" className="h-10 w-10 object-contain" />
        </div>
        <header className="py-8">
          <p className="text-xs font-bold tracking-[0.16em] text-[#2B7A58]">食光烙记</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{document.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#718075]"><span className="rounded-full bg-[#EAF4EC] px-3 py-1.5 font-semibold text-[#2B7A58]">版本 1.1</span><span className="rounded-full border border-[#DFE8E0] px-3 py-1.5">更新日期：2026年8月6日</span><span className="rounded-full border border-[#DFE8E0] px-3 py-1.5">生效日期：2026年8月6日</span></div>
          <p className="mt-6 text-sm leading-7 text-[#627168]">{document.introduction}</p>
        </header>
        <aside className="rounded-2xl border border-[#BFD8C4] bg-[#F0F7F1] p-5"><h2 className="flex items-center gap-2 text-sm font-bold text-[#215E43]"><ShieldCheck size={17} />请特别关注</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-[#466352]">{document.highlights.map((item) => <li key={item} className="flex gap-2"><span>•</span><span>{item}</span></li>)}</ul></aside>
        <div className="mt-9 space-y-9">{document.sections.map(([title, content], index) => <section key={title}><div className="flex items-start gap-3"><span className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-[#F1EBE0] px-1.5 text-xs font-bold text-[#9A6D43]">{index + 1}</span><div><h2 className="font-bold text-[#26382E]">{title}</h2><p className="mt-3 text-sm leading-7 text-[#627168]">{content}</p></div></div></section>)}</div>
        <footer className="mt-10 border-t border-[#E8EEE8] pt-6 text-center text-xs leading-6 text-[#7A897E]">感谢您花时间了解这份{document.title}<br />我们会认真保护每一份信任</footer>
      </article>
    </main>
  );
}
