import { useEffect } from 'react';
import { ArrowLeft, Clock, Calendar, ChevronRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { logoUrl } from '../assets';

interface Article {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  readTime: string;
  category: string;
  paragraphs: string[];
  quote?: string;
}

const articles: Article[] = [
  {
    id: 'onion-in-the-fridge',
    title: '从冰箱深处烂掉的半个洋葱说起',
    subtitle: '为什么市面上已有那么多菜谱软件，我们仍然想做一个食材与饮食管理工具。',
    date: '2026年10月4日',
    readTime: '4 分钟阅读',
    category: '产品初心',
    quote: '下厨这件小事的起点，从来不是“我想当米其林大厨”，而是“今天下班回到家，冰箱里还有什么能吃”。',
    paragraphs: [
      '相信很多人都有过这样的经历：周末逛超市，满怀憧憬地买回一堆漂亮的蔬菜和肉类，准备这个星期大展身手。但到了周五清理冰箱时，却往往在抽屉最底层发现被保鲜膜裹着、已经发蔫甚至发霉的半颗洋葱，或者过期两天的盒装豆腐。',
      '那种自责和浪费感是真真切切的。市面上有无数教人做精美大餐的短视频和菜谱 App，但它们大多数以“菜品为中心”——教你如何为了做一道硬菜，去买齐十三种平时根本用不上的香料；做完一次后，剩下的十二种调料又在角落默默落灰。',
      '但在每一个普通的周三晚上，下班精疲力竭推开家门的人，真正面临的困境只有两个：第一，我冰箱里究竟还剩什么？第二，手边这几个番茄和几枚鸡蛋，今晚怎么用最快、最不费脑子的方式做成能安顿自己的一餐？',
      '这就是“食光烙记”的起点。我们想做一个以“你手边的食材为中心”的伙伴：买菜回来先记下，冰箱有什么清清楚楚；想做饭时，优先帮你把即将临期的食材用掉；吃完之后顺手留个印记，看看这一周自己的身体被照顾得怎么样。',
      '好好吃饭不一定要大费周章，安顿好手边的柴米油盐，生活就有了踏实的一角。',
    ],
  },
  {
    id: 'honest-nutrition-estimates',
    title: '关于营养数据：我们为什么坚持“估算”',
    subtitle: '拒绝虚假精确，在充满变量的日常烹饪中，如何给出一份真正坦诚的参考。',
    date: '2026年9月22日',
    readTime: '5 分钟阅读',
    category: '设计与科学',
    quote: '科学的第一步是诚实。承认日常厨房中的不确定性，比给出一个小数点后两位的虚幻卡路里更有尊严。',
    paragraphs: [
      '在做饮食记录和食谱研发时，团队内部讨论最激烈的一个问题，就是到底要不要给每道菜标上“342.15 kcal”这样看似极度专业的数字。',
      '很多健康类产品喜欢这么做，因为一长串精确到小数点的数字会给用户一种“我在严格掌控身体”的安全感。但只要你真正下过厨房，就知道这在现实中是多么不切实际：食材品种、实际用量和烹饪方法都会影响结果；更不用说焯水后弃掉的汤汁、锅底残留的菜汁。',
      '如果我们假装这些变数不存在，给用户输出一个看似精确的“绝对值”，其实是在用虚假科学贩卖虚假的掌控感。',
      '所以在食光烙记里，我们希望给营养数字附带清晰说明：这是基于原方投料与样品数据的“估算”；资料不完整的食谱，我们会老老实实打上“待补全”标签；已有来源的信息会保留出处与计算条件，缺失的资料仍需补充。',
      '我们希望食光烙记是一个诚实的朋友。它给你足够好、足够踏实的参考区间，帮你大致掌握蛋白质和能量摄入，而不是用焦虑的数字让你连吃一口热饭都战战兢兢。',
    ],
  },
  {
    id: 'ai-as-co-pilot',
    title: '厨房里的“副驾驶”：AI 的边界与克制',
    subtitle: '我们希望食语助手扮演一个温和的启发者，而不是剥夺人类生活乐趣的主宰。',
    date: '2026年9月8日',
    readTime: '3 分钟阅读',
    category: '技术思考',
    quote: '做饭的过程本身就是生活的治愈剂。刀刃切进蔬菜的清脆声，锅里升腾的热气，都不应该被自动化取代。',
    paragraphs: [
      '做“食语助手”这个 AI 模块时，最容易走入的误区就是过度自动化——比如让大模型替你安排整整一个月的食谱、或者自动替你下达指令。',
      '但我们深思之后选择了克制。为什么？因为厨房是现代人少有的、还能保留“手作触觉”和“自主生活感”的自留地。洗菜时的流水声、切菜时砧板的笃笃声、热油下锅那一瞬间冒出来的香气——这些不是冷冰冰的任务，这些是把疲惫的一天安顿好的过程。',
      'AI 应当做的事情，是在你毫无头绪时递上一句启发：“看你冰箱里还有番茄和虾仁，今晚试试快手意面？”或者在你问起“牛排煎老了怎么办”时，给你一个耐心的补救小贴士。',
      '它是一个坐在厨房吧台上的副驾驶，手里捧着食谱和笔记，在你需要时轻声提醒两句，但方向盘始终在你自己的手里。',
    ],
  },
];

export default function Journal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeArticleId = searchParams.get('id');
  const activeArticle = articles.find((a) => a.id === activeArticleId);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (activeArticle) {
      window.document.title = `${activeArticle.title}｜食光手记`;
    } else {
      window.document.title = '食光手记｜把日子过进一餐一饭';
    }
  }, [activeArticle]);

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
          <Link to="/changelog" className="text-sm text-[#6d685c] hover:text-[#8a4b30] transition">
            更新日志 →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        {activeArticle ? (
          /* Single Article View */
          <article>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex items-center gap-1.5 text-xs text-[#666c58] hover:text-[#283b2e] mb-6 transition"
            >
              <ArrowLeft size={14} /> 返回所有手记
            </button>

            <header className="border-b border-[#e4ddcf] pb-8 mb-8">
              <span className="inline-block px-2.5 py-1 rounded-md text-xs font-semibold bg-[#344e39]/10 text-[#344e39]">
                {activeArticle.category}
              </span>
              <h1 className="mt-4 text-2xl sm:text-4xl font-serif font-medium text-[#283b2e] leading-snug">
                {activeArticle.title}
              </h1>
              <p className="mt-3 text-base text-[#6d685c] leading-relaxed">
                {activeArticle.subtitle}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[#8d887c]">
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} /> {activeArticle.date}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={13} /> {activeArticle.readTime}
                </span>
              </div>
            </header>

            {activeArticle.quote && (
              <blockquote className="my-8 border-l-2 border-[#a95c3e] pl-5 py-2 font-serif text-base sm:text-lg italic text-[#4a553e] bg-[#f7f2e7]/50 rounded-r-xl">
                “{activeArticle.quote}”
              </blockquote>
            )}

            <div className="space-y-6 text-[15px] sm:text-base leading-relaxed text-[#3b4b3e]">
              {activeArticle.paragraphs.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>

            <div className="mt-12 p-6 rounded-2xl bg-[#fffdf8] border border-[#e4ddcf] text-center">
              <p className="font-serif text-lg text-[#283b2e]">好好吃饭，慢慢记录。</p>
              <p className="mt-2 text-xs text-[#6d685c]">
                如果你对我们的想法有共鸣，欢迎申请加入内测或在网页版体验。
              </p>
              <div className="mt-5 flex justify-center gap-4">
                <a
                  href="https://dietdigidose.top/app/"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#344e39] text-[#fffdf7] px-5 py-2.5 text-xs font-medium hover:bg-[#273f2c] transition"
                >
                  打开网页版
                </a>
                <button
                  type="button"
                  onClick={() => setSearchParams({})}
                  className="rounded-xl border border-[#cbd1be] px-4 py-2.5 text-xs text-[#6d685c] hover:bg-[#f3ece0] transition"
                >
                  阅读其他手记
                </button>
              </div>
            </div>
          </article>
        ) : (
          /* Article List View */
          <div>
            <div className="border-b border-[#e4ddcf] pb-8 mb-12">
              <p className="text-xs font-semibold tracking-widest text-[#666c58] flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#a95c3e]" />
                MAKER'S JOURNAL & ESSAYS
              </p>
              <h1 className="mt-3 text-3xl sm:text-4xl font-serif font-medium text-[#283b2e]">
                食光手记 · 开发随笔
              </h1>
              <p className="mt-4 text-base text-[#6d685c] leading-relaxed">
                这里记录了我们在打造食光烙记过程中的初心、设计取舍、下厨日常与技术思考。
              </p>
            </div>

            <div className="space-y-8">
              {articles.map((article) => (
                <Link
                  key={article.id}
                  to={`/journal?id=${article.id}`}
                  className="group block rounded-2xl border border-[#e4ddcf] bg-[#fffdf8] p-6 sm:p-7 shadow-[0_4px_20px_#6c4f2f05] transition-all hover:border-[#9da48d] hover:shadow-[0_8px_30px_#6c4f2f0c]"
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-[#8d887c] mb-3">
                    <span className="px-2 py-0.5 rounded-md font-medium bg-[#344e39]/10 text-[#344e39]">
                      {article.category}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} /> {article.readTime}
                    </span>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-serif font-medium text-[#283b2e] group-hover:text-[#8a4b30] transition leading-snug">
                    {article.title}
                  </h2>

                  <p className="mt-2.5 text-sm text-[#6d685c] leading-relaxed">
                    {article.subtitle}
                  </p>

                  <div className="mt-5 flex items-center justify-between pt-4 border-t border-[#f0e9dc] text-xs">
                    <span className="text-[#8d887c]">{article.date}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-[#344e39] group-hover:translate-x-1 transition-transform">
                      阅读全文 <ChevronRight size={14} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-16 pt-8 border-t border-[#e4ddcf] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8d887c]">
          <p>© {new Date().getFullYear()} 食光烙记 · 把日子过进一餐一饭</p>
          <div className="flex items-center gap-4">
            <Link to="/" className="hover:text-[#283b2e] underline underline-offset-4">返回首页</Link>
            <Link to="/changelog" className="hover:text-[#283b2e] underline underline-offset-4">更新日志</Link>
            <a href="https://dietdigidose.top/app/" className="hover:text-[#283b2e] underline underline-offset-4">网页版应用</a>
          </div>
        </div>
      </main>
    </div>
  );
}
