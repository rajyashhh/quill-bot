import pdfParse from 'pdf-parse-fork'

export interface ChapterInfo {
  chapterNumber: number
  title: string
  startIndex: number
  endIndex: number
  startPage: number
  endPage: number
}

export interface TopicInfo {
  topicNumber: number
  title: string
  content: string
  estimatedTime: number
}

export class ChapterExtractor {
  private pdfText: string = ''
  private pageBreaks: number[] = []
  
  /**
   * Extract only the full text from PDF without chapter detection
   */
  async extractFullText(pdfBuffer: Buffer): Promise<string> {
    try {
      const pdfData = await pdfParse(pdfBuffer)
      return pdfData.text
    } catch (error) {
      console.error('[CHAPTER_EXTRACTOR] Error extracting text:', error)
      return ''
    }
  }
  
  /**
   * Extract chapters from PDF buffer
   */
  async extractChaptersFromPDF(pdfBuffer: Buffer): Promise<{
    chapters: ChapterInfo[]
    fullText: string
  }> {
    try {
      console.log('[CHAPTER_EXTRACTOR] Starting chapter extraction...')
      
      // Extract text from PDF
      const pdfData = await pdfParse(pdfBuffer)
      this.pdfText = pdfData.text
      
      // Find page breaks (form feed characters)
      this.findPageBreaks()
      
      // Detect chapters
      const chapters = this.detectChapters()
      
      console.log(`[CHAPTER_EXTRACTOR] Found ${chapters.length} chapters`)
      
      return {
        chapters,
        fullText: this.pdfText
      }
    } catch (error) {
      console.error('[CHAPTER_EXTRACTOR] Error:', error)
      throw error
    }
  }
  
  /**
   * Find page break positions in text
   */
  private findPageBreaks(): void {
    this.pageBreaks = [0]
    let index = 0
    
    while ((index = this.pdfText.indexOf('\f', index)) !== -1) {
      this.pageBreaks.push(index)
      index++
    }
    
    this.pageBreaks.push(this.pdfText.length)
    console.log(`[CHAPTER_EXTRACTOR] Found ${this.pageBreaks.length - 1} pages`)
  }
  
  /**
   * Get page number for a given text index
   */
  private getPageNumber(textIndex: number): number {
    for (let i = 0; i < this.pageBreaks.length - 1; i++) {
      if (textIndex >= this.pageBreaks[i] && textIndex < this.pageBreaks[i + 1]) {
        return i + 1
      }
    }
    return this.pageBreaks.length - 1
  }
  
  /**
   * Detect chapters using various patterns
   */
  private detectChapters(): ChapterInfo[] {
    const chapters: ChapterInfo[] = []
    
    // Common chapter patterns - more restrictive
    const patterns = [
      /^Chapter\s+(\d+)[\s:\-–—]*(.*)$/i,
      /^(\d{1,2})\.\s+([A-Z][^.]+)$/,  // Match "1. Basic Concepts" but not "1. rate of decompression"
      /^Part\s+(\d+)[\s:\-–—]*(.*)$/i,
      /^Section\s+(\d+)[\s:\-–—]*(.*)$/i,
      /^Unit\s+(\d+)[\s:\-–—]*(.*)$/i,
      /^Module\s+(\d+)[\s:\-–—]*(.*)$/i,
      /^Lesson\s+(\d+)[\s:\-–—]*(.*)$/i,
    ]
    
    // Split text into lines for analysis
    const lines = this.pdfText.split('\n')
    let currentIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      currentIndex = this.pdfText.indexOf(lines[i], currentIndex)
      
      // Try each pattern
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (match) {
          const chapterNumber = parseInt(match[1])
          const title = match[2].trim()
          
          // Validate it's likely a chapter (not just a numbered list item)
          if (this.isLikelyChapter(line, i, lines)) {
            chapters.push({
              chapterNumber,
              title,
              startIndex: currentIndex,
              endIndex: -1, // Will be set later
              startPage: this.getPageNumber(currentIndex),
              endPage: -1 // Will be set later
            })
            
            console.log(`[CHAPTER_EXTRACTOR] Found: Chapter ${chapterNumber} - ${title}`)
            break
          }
        }
      }
    }
    
    // Set end indices and pages
    for (let i = 0; i < chapters.length; i++) {
      if (i < chapters.length - 1) {
        chapters[i].endIndex = chapters[i + 1].startIndex - 1
        chapters[i].endPage = this.getPageNumber(chapters[i].endIndex)
      } else {
        chapters[i].endIndex = this.pdfText.length
        chapters[i].endPage = this.pageBreaks.length - 1
      }
    }
    
    // Sort chapters by number
    const sortedChapters = chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)
    
    // If we detected way too many chapters, it's likely a false positive
    if (sortedChapters.length > 50) {
      console.log(`[CHAPTER_EXTRACTOR] Warning: Detected ${sortedChapters.length} chapters, which seems excessive. Consider adjusting detection patterns.`)
    }
    
    return sortedChapters
  }
  
  /**
   * Check if a line is likely a chapter heading
   */
  private isLikelyChapter(line: string, lineIndex: number, allLines: string[]): boolean {
    // Skip lines that are clearly sub-items or list items
    if (line.match(/^(rate of|altitude of|type of|activity of|personal health|flying in|frequently|approaching)/i)) {
      return false
    }
    
    // Skip lines that are too short (likely fragments)
    if (line.length < 5) {
      return false
    }
    
    // Check if it's a main chapter pattern (numbered title at start of document or section)
    const isMainChapter = /^(\d{1,2})\.\s+[A-Z]/.test(line) || /^Chapter\s+\d{1,2}[:\s-]/i.test(line)
    
    // For main chapters, check positioning
    if (isMainChapter) {
      const prevLine = lineIndex > 0 ? allLines[lineIndex - 1].trim() : ''
      const nextLine = lineIndex < allLines.length - 1 ? allLines[lineIndex + 1].trim() : ''
      
      // Main chapters usually have space around them
      const hasSeparation = !prevLine || prevLine.length < 5
      
      return hasSeparation
    }
    
    return false
  }
  
  /**
   * Extract content for a specific chapter
   */
  extractChapterContent(fullText: string, chapter: ChapterInfo): string {
    return fullText.substring(chapter.startIndex, chapter.endIndex).trim()
  }
  
  /**
   * Identify topics within a chapter
   */
  identifyTopics(chapterContent: string): TopicInfo[] {
    const topics: TopicInfo[] = []
    
    // Common topic/section patterns
    const topicPatterns = [
      /^(\d+\.?\d*)\s+(.+?)$/m, // "1.1 Introduction"
      /^([A-Z])\.\s+(.+?)$/m, // "A. Overview"
      /^(?:Section|SECTION)\s+(\d+)[\s:.-]*(.+?)$/m,
      /^(?:Topic|TOPIC)\s+(\d+)[\s:.-]*(.+?)$/m,
      /^#{1,3}\s+(.+?)$/m, // Markdown headers
      /^([IVX]+)\.\s+(.+?)$/m, // Roman numerals
    ]
    
    // Split content into potential sections
    const lines = chapterContent.split('\n')
    const sections: { title: string; startLine: number; content: string[] }[] = []
    let currentSection: { title: string; startLine: number; content: string[] } | null = null
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      let foundTopic = false
      
      // Check if this line is a topic header
      for (const pattern of topicPatterns) {
        const match = line.match(pattern)
        if (match && this.isLikelyTopic(line, i, lines)) {
          // Save previous section
          if (currentSection) {
            sections.push(currentSection)
          }
          
          // Start new section
          currentSection = {
            title: line,
            startLine: i,
            content: []
          }
          foundTopic = true
          break
        }
      }
      
      // If not a topic header, add to current section content
      if (!foundTopic && currentSection && line) {
        currentSection.content.push(line)
      }
    }
    
    // Don't forget the last section
    if (currentSection) {
      sections.push(currentSection)
    }
    
    // If no sections found, treat the whole chapter as one topic
    if (sections.length === 0) {
      sections.push({
        title: 'Main Content',
        startLine: 0,
        content: lines.filter(l => l.trim())
      })
    }
    
    // Convert sections to topics
    sections.forEach((section, index) => {
      const content = section.content.join('\n')
      const wordCount = content.split(/\s+/).length
      const estimatedTime = Math.max(1, Math.ceil(wordCount / 200)) // Assume 200 words per minute
      
      topics.push({
        topicNumber: index + 1,
        title: this.cleanTopicTitle(section.title),
        content: content,
        estimatedTime
      })
    })
    
    return topics
  }
  
  /**
   * Check if a line is likely a topic heading
   */
  private isLikelyTopic(line: string, lineIndex: number, allLines: string[]): boolean {
    // Similar to chapter detection but less strict
    const prevLine = lineIndex > 0 ? allLines[lineIndex - 1].trim() : ''
    const nextLine = lineIndex < allLines.length - 1 ? allLines[lineIndex + 1].trim() : ''
    
    // Topics might not have empty lines around them
    const hasEmptyLineBefore = !prevLine
    const isShort = line.length < 80
    const hasNumbering = /^[\d.]+\s|^[A-Z]\.|^[IVX]+\./.test(line)
    
    return (hasEmptyLineBefore || hasNumbering) && isShort
  }
  
  /**
   * Clean up topic title
   */
  private cleanTopicTitle(title: string): string {
    // Remove numbering patterns but keep the actual title
    return title
      .replace(/^[\d.]+\s+/, '')
      .replace(/^[A-Z]\.\s+/, '')
      .replace(/^[IVX]+\.\s+/, '')
      .replace(/^(?:Section|SECTION|Topic|TOPIC)\s+\d+[\s:.-]*/, '')
      .replace(/^#+\s+/, '')
      .trim()
  }
  
  /**
   * Estimate total reading time for a chapter
   */
  estimateChapterTime(topics: TopicInfo[]): number {
    return topics.reduce((total, topic) => total + topic.estimatedTime, 0)
  }
}
