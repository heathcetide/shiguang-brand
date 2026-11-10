import { useEffect, useState } from "react";
import { Image, Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { systemApi, type AIDataPolicy } from "@/services/api";

type LegalSection = {
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  notice?: string;
};

type LegalDocument = {
  title: string;
  updated: string;
  effective: string;
  version: string;
  introduction: string;
  highlights: readonly string[];
  sections: readonly LegalSection[];
};

const policies: Record<"privacy" | "terms", LegalDocument> = {
  privacy: {
    title: "隐私政策",
    updated: "更新日期：2026年8月6日",
    effective: "生效日期：2026年8月6日",
    version: "版本 1.1",
    introduction:
      "食光烙记运营团队（以下称“我们”）重视您的个人信息和隐私安全。本政策说明我们在您使用食光烙记时，如何收集、使用、保存、共享和保护相关信息，以及您如何管理自己的信息。请在使用服务前仔细阅读。",
    highlights: [
      "健康、疾病、用药、过敏及未满十四周岁未成年人的信息属于敏感个人信息。",
      "拒绝提供可选信息不会影响账号、基础库存和饮食记录等核心功能，但相关个性化功能可能无法使用。",
      "AI 建议仅用于日常饮食与健康管理，不替代医生、药师或注册营养师的专业意见。",
    ],
    sections: [
      {
        title: "适用范围与运营者",
        paragraphs: [
          "本政策适用于食光烙记客户端、网页端及由我们提供的相关服务。当前运营主体及有效联系方式，以应用商店开发者信息和正式发布渠道展示的信息为准。",
          "第三方通过其独立页面或服务收集信息的，适用该第三方的隐私规则；我们会在合理范围内审慎选择合作方，并要求其依法保护您的信息。",
        ],
      },
      {
        title: "我们处理的信息",
        paragraphs: [
          "我们遵循合法、正当、必要和诚信原则，仅处理实现明确功能所需的信息。具体范围取决于您实际使用的功能。",
        ],
        bullets: [
          "账号与安全信息：邮箱或手机号、加密后的密码、头像、简介、账号创建时间，以及登录时间、IP 地址、设备或浏览器标识等安全日志。",
          "饮食与厨房信息：食材名称、数量、保质期、存放位置、厨具、购物清单、饮食记录、营养数据、收藏及您提交的菜谱。",
          "健康与偏好信息：年龄、性别、身高、体重、体脂、腰臀围、心率、血压、血糖、睡眠、饮水、周期状态、健康目标、饮食偏好，以及您主动填写的过敏、不耐受、疾病、用药和专业建议。",
          "社区信息：用户名、头像、简介、动态、图片、评论、点赞、关注、活动参与和问答互动。公开发布的内容可能被其他用户查看、转发或保存。",
          "AI 交互信息：您提交的文字、语音转写、所选图片，以及为生成个性化结果所必需的近期饮食、库存和健康资料。",
          "通知信息：通知偏好、设备平台和推送令牌，用于发送您开启的到期、用餐、饮水或服务通知。",
        ],
        notice:
          "健康与医疗相关信息具有敏感性。您可以不填写，或仅填写完成当前功能所需的最少内容；请勿上传身份证件、完整病历等无关信息。",
      },
      {
        title: "设备权限",
        paragraphs: [
          "我们只会在您使用对应功能时申请系统权限。您可以拒绝或在设备设置中随时关闭权限；关闭后仅对应功能受限。",
        ],
        bullets: [
          "相册：选择您指定的头像、饮食、食材、菜谱或社区图片，不会主动读取整个相册。",
          "相机：拍摄食材、餐食或小票用于记录和识别；未调用拍摄功能时不会使用相机。",
          "麦克风：在您主动录音或开启语音唤醒功能期间接收语音，用于语音转文字和烹饪指令。",
          "通知：在您授权后发送提醒。用餐和饮水提醒可在设备本地生成；推送服务会使用设备推送令牌。",
        ],
      },
      {
        title: "我们如何使用信息",
        paragraphs: [
          "我们会将信息用于创建和维护账号、同步您的记录、提供库存与到期提醒、计算营养参考、展示社区内容、完成图片或语音识别、生成个性化建议、响应客服请求，以及保障账号和服务安全。",
          "我们还可能使用去标识化或汇总后的数据分析功能表现、修复故障和改进服务。此类数据不会用于重新识别您。未经另行说明并取得必要授权，我们不会将您的个人信息用于与上述目的无关的广告营销。",
        ],
      },
      {
        title: "AI 功能的特别说明",
        paragraphs: [
          "当您使用食语 AI、图片识别或语音识别时，完成请求所需的文字、图片、音频或相关上下文会经我们的服务器发送给当前配置的模型服务商处理。不同功能可能使用不同模型服务。我们不会以改善第三方通用模型为目的主动提供您的信息。",
          "AI 对话会保存在您的设备本地，同时服务端会按账号和会话保存完整的用户消息与 AI 回复；为保持对话连贯，一次请求最多携带最近 50 条有效消息。服务端还会记录模型名称、用量、延迟、成功状态和失败原因，用于计量、排障和安全审计。授权管理员可能在必要的排障和安全审计范围内查看对话内容。",
          "本地对话与采购等缓存可在“设置—清理本地缓存”中删除；这不会删除服务端对话。注销账号会删除账号及其服务端 AI 对话。若需在保留账号的情况下导出或删除服务端对话，请通过正式发布渠道展示的支持方式联系我们；在提供自助入口前，我们会按核验后的请求处理。",
          "模型输出基于概率生成，可能不准确、不完整或不适合您的实际情况。涉及严重过敏、慢性病、孕产期、用药调整或紧急症状时，请停止依赖 AI 输出并及时咨询专业人员。",
        ],
        notice: "使用 AI 前，请避免输入与当前请求无关的敏感个人信息或他人信息。",
      },
      {
        title: "委托处理、共享与公开",
        paragraphs: [
          "为实现必要功能，我们可能委托基础设施、消息推送、AI 模型、图片存储或故障处理等服务提供者处理最少范围的信息。相关接收方只能按照我们的指示和约定目的处理，并承担保密与安全义务。具体服务商可能因部署环境而不同，正式上线前我们会通过第三方信息清单披露其名称、联系方式、处理目的、方式和信息种类。",
          "除取得您的单独同意、为履行法定义务或法律另有规定外，我们不会向其他个人信息处理者提供您的个人信息，也不会出售个人信息。发生合并、分立、收购或资产转让时，我们会依法告知接收方，并要求其继续受本政策约束。",
          "您主动发布到社区的用户名、头像、动态、图片、评论和互动将被公开展示。请勿公开联系方式、住址、病历或他人的个人信息。",
        ],
      },
      {
        title: "信息保存与跨境处理",
        paragraphs: [
          "账号、业务记录和服务端 AI 对话目前通常保存至您删除相应记录、提出经核验的删除请求或注销账号；本地缓存保存至您清除缓存、卸载应用或删除账号；安全与审计记录按照法律要求和合理的风险防控期限保存。正式上线前运营方应在第三方清单中公布可执行的具体保留期限；期限届满后依法删除或匿名化处理。",
          "原则上，我们将在中华人民共和国境内存储在境内收集的个人信息。如因所选服务商或功能需要向境外提供个人信息，我们会依法完成相应程序，向您告知接收方等事项，并在适用时取得单独同意。在未完成这些要求前，不进行相关跨境提供。",
        ],
      },
      {
        title: "信息安全",
        paragraphs: [
          "我们采取访问控制、密码加密存储、身份认证、传输保护、最小权限和安全审计等措施，降低信息被泄露、篡改、丢失或滥用的风险。互联网环境无法保证绝对安全，请使用强密码并妥善保管账号凭据。",
          "如发生可能影响您权益的个人信息安全事件，我们将依法采取补救措施，并通过应用通知、消息或其他合理方式告知事件情况、可能影响、已采取措施和您可采取的防范建议。",
        ],
      },
      {
        title: "您的权利",
        paragraphs: [
          "您可以依法查阅、复制、更正、补充、删除或限制处理自己的个人信息，也可以撤回基于同意作出的授权。撤回不影响此前基于有效授权已进行的处理。",
        ],
        bullets: [
          "在个人资料、健康档案和各记录页面中查看、更正或逐条删除信息。",
          "在系统设置中关闭相机、相册、麦克风或通知权限，并在应用设置中调整提醒偏好。",
          "在“设置—通用与数据管理”中清理本地缓存。",
          "在“设置—永久删除账号与数据”中验证密码并注销账号。该操作不可恢复。",
          "如页面暂未提供相应入口，可通过正式发布渠道展示的支持方式联系我们。我们将在法律规定期限内处理。",
        ],
      },
      {
        title: "未成年人保护",
        paragraphs: [
          "不满十四周岁的未成年人应在父母或其他监护人阅读并同意专门的未成年人个人信息处理规则后使用服务。若我们发现未取得监护人同意而处理了儿童个人信息，将尽快删除或采取其他必要措施。",
          "十四周岁以上未满十八周岁的用户，建议在监护人指导下阅读并使用服务。监护人如需查询、更正或删除被监护人的信息，可以通过正式支持渠道联系我们。",
        ],
      },
      {
        title: "政策更新与联系我们",
        paragraphs: [
          "我们可能因功能、处理方式或法律要求变化而更新本政策。涉及处理目的、信息种类、使用方式或您的权利发生重大变化时，我们会通过弹窗、站内通知或其他显著方式告知，并在依法需要时重新取得您的同意。",
          "如对本政策、个人信息处理或账号注销有疑问、意见或投诉，请通过应用商店开发者联系方式或正式发布渠道联系我们。为核实身份并保障账号安全，我们可能要求您提供必要的验证信息。",
        ],
      },
    ],
  },
  terms: {
    title: "用户协议",
    updated: "更新日期：2026年8月6日",
    effective: "生效日期：2026年8月6日",
    version: "版本 1.1",
    introduction:
      "欢迎使用食光烙记。本协议是您与食光烙记运营团队之间关于注册账号、访问客户端或网页端以及使用相关服务的约定。请特别阅读涉及健康提示、AI 输出、用户内容、责任限制和账号终止的条款。",
    highlights: [
      "食光烙记是日常饮食与健康管理工具，不提供医疗诊断、处方或紧急救助服务。",
      "AI、热量和营养数据均可能存在误差，重要决定应由具备资质的专业人员复核。",
      "您保留原创内容的权利，但公开发布前请确认拥有必要权利且不包含不应公开的信息。",
    ],
    sections: [
      {
        title: "协议的确认与适用",
        paragraphs: [
          "当您注册、登录或实际使用服务，即表示您已阅读并同意本协议和《隐私政策》。若您不同意其中任何内容，请停止注册或使用。对于依法需要单独同意的事项，我们会另行征求您的选择。",
          "本协议适用于食光烙记现有及后续提供的客户端、网页端和相关服务。具体功能、使用条件和页面提示构成本协议的一部分；页面提示与本协议不一致时，以更有利于保护您合法权益且符合法律规定的内容为准。",
        ],
      },
      {
        title: "用户资格与未成年人",
        paragraphs: [
          "您应具备与所进行行为相适应的民事行为能力。不满十四周岁的用户应由监护人阅读并同意本协议及专门的未成年人隐私规则后使用；其他未成年人应在监护人指导下使用。",
          "监护人应关注未成年人的内容发布和健康信息填写，并帮助其理解营养建议的局限性。若您代表组织使用服务，应确保已获得充分授权。",
        ],
      },
      {
        title: "账号注册与安全",
        paragraphs: [
          "您应使用本人可合法使用的邮箱或手机号注册，并保证提交信息真实、准确、完整。不得冒用他人身份、批量注册、买卖、出租、出借或以其他方式转让账号。",
          "请妥善保管登录凭据，并对账号下的操作负责。发现异常登录或凭据泄露时，请立即修改密码并联系我们。因我们的过错造成损失的，我们依法承担相应责任；因您主动泄露凭据等自身原因造成的损失，由您依法承担相应责任。",
        ],
      },
      {
        title: "服务内容与使用方式",
        paragraphs: [
          "食光烙记提供食材库存、保质期提醒、饮食与健康记录、营养参考、菜谱、购物清单、AI 助手、图片或语音识别、社区互动等功能。部分功能可能需要登录、联网、设备权限或完整的健康资料。",
          "我们会持续改进服务，并可能新增、调整、暂停或停止部分功能。对于影响您主要权益的重大变化，我们会在合理期限内以显著方式通知，并为您管理或导出相关数据提供合理安排。",
        ],
      },
      {
        title: "健康、营养与安全提示",
        paragraphs: [
          "服务展示的热量、营养素、分量、保质期和饮水目标等数据，可能来自用户输入、公共资料、算法估算或第三方数据，仅供日常记录和参考，不保证完全准确、完整或适合每个人。请以食品标签、实际储存状况和专业意见为准。",
          "本服务不构成医疗诊断、治疗、处方、用药调整或紧急救助建议。出现呼吸困难、严重过敏、胸痛、意识异常等紧急情况时，请立即联系当地急救机构。患有疾病、处于孕产期、服用药物或有严重食物过敏时，请在改变饮食或健康计划前咨询医生、药师或注册营养师。",
        ],
        notice: "任何情况下，都不要仅依据应用提示处理危及生命或需要专业诊疗的问题。",
      },
      {
        title: "AI 与识别功能",
        paragraphs: [
          "AI 生成内容、图片识别、语音识别和自动估算具有不确定性，可能出现事实错误、遗漏、误识别或不适当建议。您应在保存记录、采购食材、食用菜品或采取健康行动前自行核对。",
          "AI 对食材和健康风险的提示不能保证识别所有过敏原、药物相互作用、交叉污染或禁忌。您不得利用 AI 功能生成违法有害内容、侵犯他人权利、绕过安全措施，或将输出冒充专业医疗意见。",
          "AI 提供的待保存记录会尽可能由您确认后写入账号；您应检查名称、分量、日期和营养数据，并对最终确认的内容负责。",
        ],
      },
      {
        title: "用户内容与授权",
        paragraphs: [
          "您对依法享有权利的原创内容仍保留相应权利。为存储、展示、传输、审核和提供您选择的分享功能，您授予我们一项在服务运营所需范围内、非独占、可撤回的使用许可。该许可不代表我们取得内容所有权；当您删除内容后，我们将在合理期限内停止使用，法律另有规定或内容已被他人合法保存的除外。",
          "发布内容前，请确保您拥有文字、图片、肖像、商标和其他素材的必要权利，并已取得涉及他人个人信息所需的授权。社区中的健康经验仅代表发布者个人观点，不应被视为专业结论。",
        ],
      },
      {
        title: "行为规范",
        paragraphs: [
          "您使用服务时应遵守法律法规、公序良俗和社区规则，不得实施或协助实施下列行为：",
        ],
        bullets: [
          "发布违法、虚假、欺诈、淫秽、暴力、歧视、骚扰、侵权或危害他人的内容。",
          "传播危险的节食、催吐、滥用药物或其他可能造成严重人身伤害的方法。",
          "未经授权收集、公开或交易他人的个人信息、健康信息或账号凭据。",
          "攻击、干扰、反向破解服务，绕过访问控制，批量抓取数据或植入恶意代码。",
          "冒充专业人员、伪造资质，或利用服务从事未经许可的医疗、广告和商业活动。",
        ],
      },
      {
        title: "知识产权与第三方服务",
        paragraphs: [
          "除用户依法拥有的内容外，食光烙记的产品设计、软件、标识、界面、文字编排及其他内容的相关权利归我们或合法权利人所有。未经许可，不得复制、修改、出售、出租或用于超出正常使用服务范围的商业目的。",
          "服务可能接入推送、AI 模型、营养数据或其他第三方能力。第三方提供的内容和服务受其自身条款约束。我们会依法选择和管理合作方；因我们的选择或管理过错造成损害的，我们依法承担责任。",
        ],
      },
      {
        title: "服务可用性与变更",
        paragraphs: [
          "我们努力保持服务稳定，但设备故障、网络波动、维护升级、第三方服务异常、不可抗力或监管要求可能导致暂时中断。我们会在合理范围内及时修复并降低影响。",
          "我们可能基于安全风险、产品调整或法律要求更新功能。若停止运营，我们将依法提前公告，并为您处理账号和数据提供合理途径。",
        ],
      },
      {
        title: "违规处理与申诉",
        paragraphs: [
          "如您违反法律、本协议或社区规则，我们可根据行为性质采取提醒、限制发布、删除违法内容、暂停功能或终止账号等必要措施。除紧急处置或法律禁止告知外，我们会说明主要理由，并提供合理的申诉渠道。",
          "我们仅在必要范围内采取措施，不会免除自身依法应承担的责任，也不会限制消费者依法享有的投诉、举报和救济权利。",
        ],
      },
      {
        title: "账号注销与服务终止",
        paragraphs: [
          "您可以在“设置—永久删除账号与数据”中验证密码并注销账号。注销后，账号及关联数据将被删除或匿名化，且无法恢复；法律要求保留的安全、审计或争议处理信息除外。请在操作前自行保存仍需使用的内容。",
          "账号终止不影响终止前已产生的权利义务。您公开发布的内容被其他用户合法转发、引用或保存在其设备中的，可能无法因账号注销而同步删除。",
        ],
      },
      {
        title: "责任范围",
        paragraphs: [
          "我们按照法律规定对服务承担责任。本协议中的任何内容均不排除或限制因故意、重大过失、人身损害，或依法不得限制的其他情形产生的责任，也不影响您作为消费者依法享有的权利。",
          "对于用户自行输入错误、未核对 AI 输出、违反储存或烹饪常识，或超出服务设计目的使用所产生的后果，各方根据自身过错依法承担相应责任。",
        ],
      },
      {
        title: "协议更新、法律适用与联系",
        paragraphs: [
          "我们可能因功能或法律变化更新本协议。重大变更会通过弹窗、站内通知或其他显著方式告知；您不同意更新内容的，可以停止使用并注销账号。更新不会不当减损您已经依法享有的权利。",
          "本协议的订立、履行和争议解决适用中华人民共和国法律。发生争议时，双方应先友好协商；协商不成的，可依法向有管辖权的人民法院提起诉讼。法律对消费者争议解决另有强制规定的，从其规定。",
          "如需投诉、申诉或咨询，请通过应用商店开发者联系方式或正式发布渠道联系我们。",
        ],
      },
    ],
  },
};

function HighlightCard({ items }: { items: readonly string[] }) {
  return (
    <View className="mb-7 rounded-3xl border border-brand bg-brand-soft p-5">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-full bg-brand-fill">
          <FontAwesome6 name="shield-halved" size={12} colorClassName="accent-on-brand" />
        </View>
        <Text className="text-sm font-black text-brand">请特别关注</Text>
      </View>
      <View className="gap-3">
        {items.map((item) => (
          <View key={item} className="flex-row gap-2.5">
            <View className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-fill" />
            <Text className="flex-1 text-sm leading-6 text-brand">{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SectionBlock({ index, section }: { index: number; section: LegalSection }) {
  return (
    <View className="mb-7">
      <View className="mb-3 flex-row items-start gap-3">
        <View className="h-7 min-w-7 items-center justify-center rounded-lg bg-background-secondary px-1.5">
          <Text className="text-xs font-black text-warm">{index}</Text>
        </View>
        <Text className="flex-1 pt-0.5 text-base font-black leading-6 text-ink">{section.title}</Text>
      </View>

      <View className="pl-10">
        {section.paragraphs.map((paragraph) => (
          <Text key={paragraph} className="mb-3 text-sm leading-7 text-copy-muted">
            {paragraph}
          </Text>
        ))}

        {section.bullets?.length ? (
          <View className="mb-3 gap-2.5">
            {section.bullets.map((item) => (
              <View key={item} className="flex-row gap-2.5">
                <Text className="text-sm leading-7 text-warm">•</Text>
                <Text className="flex-1 text-sm leading-7 text-copy-muted">{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {section.notice ? (
          <View className="mt-1 flex-row gap-2.5 rounded-2xl border border-warm bg-warm-soft p-3.5">
            <FontAwesome6 name="circle-exclamation" size={13} colorClassName="accent-warm" style={{ marginTop: 4 }} />
            <Text className="flex-1 text-xs leading-5 text-warm">{section.notice}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function LegalScreen() {
  const router = useSafeRouter();
  const { type } = useSafeSearchParams<{ type?: string | string[] }>();
  const selectedType = (Array.isArray(type) ? type[0] : type) === "terms" ? "terms" : "privacy";
  const policy = policies[selectedType];
  const [aiPolicy, setAIPolicy] = useState<AIDataPolicy | null>(null);

  useEffect(() => {
    if (selectedType !== "privacy") return;
    void systemApi.aiDataPolicy().then(setAIPolicy).catch(() => setAIPolicy(null));
  }, [selectedType]);

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <View className="flex-row items-center border-b border-line bg-canvas px-5 py-3">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface shadow-xs"
        >
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="flex-1 text-center text-lg font-black text-ink">{policy.title}</Text>
        <View className="w-10" />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5 flex-row flex-wrap gap-2">
          <View className="rounded-full bg-brand-fill px-3 py-1.5">
            <Text className="text-[11px] font-black text-white">{policy.version}</Text>
          </View>
          <View className="rounded-full border border-line bg-surface px-3 py-1.5">
            <Text className="text-[11px] font-bold text-copy-muted">{policy.updated}</Text>
          </View>
          <View className="rounded-full border border-line bg-surface px-3 py-1.5">
            <Text className="text-[11px] font-bold text-copy-muted">{policy.effective}</Text>
          </View>
        </View>

        <Text className="mb-6 text-sm leading-7 text-copy-muted">{policy.introduction}</Text>
        <HighlightCard items={policy.highlights} />

        {selectedType === "privacy" && aiPolicy ? (
          <View className="mb-7 rounded-3xl border border-line bg-info-soft p-5">
            <Text className="text-sm font-black text-info">当前 AI 数据处理配置</Text>
            <Text className="mt-2 text-sm leading-6 text-info">处理方：{aiPolicy.providerName}</Text>
            <Text className="text-sm leading-6 text-info">处理地区：{aiPolicy.processingRegion}</Text>
            <Text className="text-sm leading-6 text-info">服务端对话保留：最多 {aiPolicy.conversationRetentionDays} 天</Text>
            <Text className="text-sm leading-6 text-info">数据请求联系：{aiPolicy.supportContact}</Text>
            {aiPolicy.providerPrivacyUrl ? (
              <TouchableOpacity onPress={() => void Linking.openURL(aiPolicy.providerPrivacyUrl!)} className="mt-2 self-start">
                <Text className="text-xs font-bold text-info underline">查看处理方隐私说明</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <View className="mb-6 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-line" />
          <Text className="text-xs font-black tracking-widest text-copy-muted">正文</Text>
          <View className="h-px flex-1 bg-line" />
        </View>

        {policy.sections.map((section, index) => (
          <SectionBlock key={section.title} index={index + 1} section={section} />
        ))}

        <View className="mt-1 items-center rounded-3xl border border-line bg-surface px-5 py-6">
          <Image
            source={require("@/assets/logo.png")}
            style={{ width: 48, height: 48 }}
            resizeMode="contain"
            accessible={false}
          />
          <Text className="mt-2 text-sm font-black text-ink">食光烙记</Text>
          <Text className="mt-1 text-center text-xs leading-5 text-copy-muted">感谢您花时间了解这份{policy.title}</Text>
          <Text className="text-center text-xs leading-5 text-copy-muted">我们会认真保护每一份信任</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
