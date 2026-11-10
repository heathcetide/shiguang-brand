package parser

// SupportedDocumentFormat is one file type the upload pipeline can parse (see DetectFileType / DefaultRouter).
type SupportedDocumentFormat struct {
	Extension   string `json:"extension"`
	Description string `json:"description"`
}

// SupportedDocumentFormats lists extensions accepted for knowledge upload.
func SupportedDocumentFormats() []SupportedDocumentFormat {
	return []SupportedDocumentFormat{
		{".txt", "纯文本"},
		{".md", "Markdown"},
		{".markdown", "Markdown"},
		{".mdx", "MDX (Markdown with JSX)"},
		{".csv", "CSV"},
		{".html", "HTML"},
		{".htm", "HTML"},
		{".json", "JSON"},
		{".yaml", "YAML"},
		{".yml", "YAML"},
		{".eml", "邮件"},
		{".rtf", "RTF"},
		{".pdf", "PDF"},
		{".doc", "Word 97-2003 (.doc)"},
		{".docx", "Word"},
		{".pptx", "PowerPoint"},
		{".xlsx", "Excel"},
		{".epub", "EPUB 电子书"},
		{".mhtml", "MHTML 网页归档"},
		{".mht", "MHTML 网页归档"},
		{".png", "图片（OCR）"},
		{".jpg", "图片（OCR）"},
		{".jpeg", "图片（OCR）"},
		{".webp", "图片（OCR）"},
		{".gif", "图片（OCR）"},
		{".bmp", "图片（OCR）"},
		{".tif", "图片（OCR）"},
		{".tiff", "图片（OCR）"},
		{".wav", "音频（ASR）"},
		{".mp3", "音频（ASR）"},
		{".ogg", "音频（ASR）"},
		{".flac", "音频（ASR）"},
		{".m4a", "音频（ASR）"},
		{".aac", "音频（ASR）"},
		{".xml", "XML"},
		{".toml", "TOML"},
		{".tsv", "TSV (Tab-Separated Values)"},
		{".ics", "iCalendar 日历"},
		{".vcf", "vCard 通讯录"},
		{".log", "日志文件"},
		{".odt", "OpenDocument Text"},
		{".ods", "OpenDocument Spreadsheet"},
		{".odp", "OpenDocument Presentation"},
		{".svg", "SVG 矢量图"},
	}
}

// SupportedDocumentNotes are caveats for operators / UI.
func SupportedDocumentNotes() []string {
	return []string{
		"旧版 .doc 使用 OLE 启发式提取，复杂排版可能不完整",
		"扫描版 PDF 无法提取文字，请先 OCR 或转换为文本 PDF",
		"图片 OCR 需注册云厂商 OCR provider（阿里云/腾讯云/百度/Google/Azure/AWS）",
		"音频 ASR 需注入 recognizer.Engine（local/volcengine/qcloud 等），通过 NewASRParser 构造",
		"非 WAV/MP3 音频解码可能需要系统安装 ffmpeg",
	}
}
