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
      console.log('[CHAPTER_EXTRACTOR] Starting smart chapter extraction...')

      // Extract text from PDF
      const pdfData = await pdfParse(pdfBuffer)
      this.pdfText = pdfData.text

      // Find page breaks (form feed characters)
      this.findPageBreaks()

      // 1. Try Table of Contents detection first (High Precision)
      let chapters = this.detectToC()

      if (chapters.length > 2) {
        console.log(`[CHAPTER_EXTRACTOR] Successfully found ${chapters.length} chapters from Table of Contents.`)

        // ToC gives us starting pages, but we need to map them to text indices
        this.mapPagesToIndices(chapters)
      } else {
        console.log('[CHAPTER_EXTRACTOR] No reliable Table of Contents found. Falling back to semantic text analysis.')
        // 2. Fallback to Smart Text Detection (High Recall)
        chapters = this.detectChaptersSmart()
      }

      // Post-process: Fill in end indices/pages and validation
      this.finalizeChapters(chapters)

      console.log(`[CHAPTER_EXTRACTOR] Final result: ${chapters.length} chapters`)

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
   * Extract chapters from raw text (e.g. from OCR)
   */
  async extractChaptersFromText(text: string): Promise<{
    chapters: ChapterInfo[]
    fullText: string
  }> {
    try {
      console.log('[CHAPTER_EXTRACTOR] Starting chapter extraction from text...')
      this.pdfText = text

      // Find page breaks (OCR markers or form feeds)
      this.findPageBreaks()

      // 1. Try Table of Contents detection
      let chapters = this.detectToC()

      if (chapters.length > 2) {
        console.log(`[CHAPTER_EXTRACTOR] Successfully found ${chapters.length} chapters from Table of Contents.`)
        this.mapPagesToIndices(chapters)
      } else {
        console.log('[CHAPTER_EXTRACTOR] No reliable Table of Contents found. Falling back to semantic text analysis.')
        chapters = this.detectChaptersSmart()
      }

      this.finalizeChapters(chapters)
      return { chapters, fullText: this.pdfText }
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

    // Check for OCR style page markers first: "--- Page X ---"
    const ocrPagePattern = /--- Page \d+ ---/g
    let match
    let foundOCRBreaks = false

    while ((match = ocrPagePattern.exec(this.pdfText)) !== null) {
      this.pageBreaks.push(match.index)
      foundOCRBreaks = true
    }

    if (foundOCRBreaks) {
      console.log(`[CHAPTER_EXTRACTOR] Found ${this.pageBreaks.length - 1} pages using OCR markers`)
    } else {
      // Fallback to Form Feed (\f) for standard PDFs
      let index = 0
      while ((index = this.pdfText.indexOf('\f', index)) !== -1) {
        this.pageBreaks.push(index)
        index++
      }
    }

    this.pageBreaks.push(this.pdfText.length)
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
    return Math.max(1, this.pageBreaks.length - 1)
  }

  /**
   * Get approx text index for a page number
   */
  private getIndexForPage(page: number): number {
    if (page <= 1) return 0
    if (page >= this.pageBreaks.length) return this.pdfText.length
    return this.pageBreaks[page - 1]
  }

  /**
   * Attempt to find and parse Table of Contents
   */
  private detectToC(): ChapterInfo[] {
    const chapters: ChapterInfo[] = []

    // Scan first 30 pages for ToC to handle longer intros
    const first30PagesLength = this.pageBreaks.length > 30 ? this.pageBreaks[30] : this.pdfText.length
    const introText = this.pdfText.substring(0, first30PagesLength)

    // Look for ToC Header with more flexible regex
    // Matches: "Table of Contents", "CONTENTS", "Index", "Content", maybe with prefix "A Table of..."
    const tocHeaderMatch = introText.match(/(?:Table of Contents|CONTENTS|Index|Content)\s*$/im)
    if (!tocHeaderMatch) return []

    const tocStartIndex = tocHeaderMatch.index! + tocHeaderMatch[0].length

    // Increase scan window to 8000 chars to cover multi-page ToCs (approx 2-3 pages)
    const tocContentSpec = introText.substring(tocStartIndex, tocStartIndex + 8000)

    const lines = tocContentSpec.split('\n')

    // 🌟 Handle "Blob" ToC (where newlines are missing)
    if (lines.length < 5 && tocContentSpec.length > 200) {
      console.log('[CHAPTER_EXTRACTOR] Few lines detected in ToC. Attempting regex extraction on full block.')
      const blobChapters: ChapterInfo[] = []

      // Matches: "010.01 Title ...... 1" or "1. Title ...... 5"
      // Must have dot leaders (..) to be safe in a blob
      const blobPattern = /(?:^|\s)(\d+(?:[.-]\d+)*)[.:]?\s+([^\.]+?)\s*\.{3,}\s*(\d+)(?=\s|$|\d)/g

      let match
      while ((match = blobPattern.exec(tocContentSpec)) !== null) {
        const numStr = match[1]
        const title = match[2].trim()
        const page = parseInt(match[3])

        if (!isNaN(page) && page <= this.pageBreaks.length && page > 0) {
          blobChapters.push({
            chapterNumber: blobChapters.length + 1,
            title: `${numStr} ${title}`,
            startIndex: -1,
            endIndex: -1,
            startPage: page,
            endPage: -1
          })
        }
      }

      if (blobChapters.length > 2) {
        console.log(`[CHAPTER_EXTRACTOR] Extracted ${blobChapters.length} chapters from single-block ToC`)
        return blobChapters
      }
    }

    // Regex strategies for different ToC styles
    const strategies = [
      // Complex numbering: "040.01 Title ...... 1", "1.1.2 Title ... 5"
      // Capture 1: Number (dots allowed), Capture 2: Title, Capture 3: Page
      /^(?:Chapter\s+)?([\w\d]+(?:[.-]\d+)*)\s*[:.]?\s+(.*?)\.{3,}\s*(\d+)$/i,

      // Spaced Layout: "01.00 Title    24" (Requires significant gap or simplistic structure)
      /^([\w\d]+(?:[.-]\d+)*)\.?\s+(.*?)\s{3,}(\d+)$/,
    ]

    let chapterCounter = 0
    let consecutiveMisses = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue;

      // If we see typical end-of-toc markers, stop
      if (/^Glossary|^Index|^Appendix/i.test(trimmed) && chapters.length > 3) break

      let matched = false
      for (const pattern of strategies) {
        const match = trimmed.match(pattern)
        if (match) {
          const numStr = match[1]
          const title = match[2].trim()
          const pageStr = match[3]

          const page = parseInt(pageStr)

          // Sanity check: page must be valid
          if (!isNaN(page) && page <= this.pageBreaks.length && page > 0) {
            // Use a strict sequential integer for the database ID to avoid float/int collisions
            chapterCounter++

            chapters.push({
              chapterNumber: chapterCounter,
              title: `${numStr} ${title}`, // Keep the original numbering in the title
              startIndex: -1,
              endIndex: -1,
              startPage: page,
              endPage: -1
            })
            matched = true
            consecutiveMisses = 0
          }
          break
        }
      }

      if (!matched) {
        consecutiveMisses++
        // Only break if we have a solid list effectively ending (e.g. >25 non-matching lines)
        // and we have already found some chapters. This handles "Section headers" in ToC that don't have page numbers.
        if (chapters.length > 5 && consecutiveMisses > 25) break
      }
    }

    return chapters
  }

  /**
   * Map page numbers from ToC to actual text indices
   */
  private mapPagesToIndices(chapters: ChapterInfo[]) {
    for (const chapter of chapters) {
      chapter.startIndex = this.getIndexForPage(chapter.startPage)
      // Refine start index: Search for the title near the top of that page
      const pageTextEnd = this.pageBreaks[chapter.startPage] || this.pdfText.length
      const pageSnippet = this.pdfText.substring(chapter.startIndex, Math.min(chapter.startIndex + 1000, pageTextEnd))

      // Fuzzy match title in the page text to refine start index
      // Simple check: literal match
      // We also clean the title (remove numbering) for matching because the page text might not match "040.01 Title" exactly
      const cleanTitle = chapter.title.replace(/^[\w\d.]+/, '').trim()
      const titleIndex = pageSnippet.indexOf(cleanTitle)
      if (titleIndex !== -1) {
        chapter.startIndex += titleIndex
      }
    }
  }

  /**
   * Detect chapters using heuristic patterns on the full text
   */
  private detectChaptersSmart(): ChapterInfo[] {
    const chapters: ChapterInfo[] = []

    // Patterns ranked by confidence
    const patterns = [
      { regex: /^Chapter\s+(\d+)[\s:\-–—]+(.+)$/i, confidence: 1.0 }, // Explicit "Chapter N: Title"
      { regex: /^(\d+)\.\s+([A-Z][A-Za-z\s:,-]+)$/, confidence: 0.8 }, // "1. Title" (Strict capitalization)
      { regex: /^Unit\s+(\d+)[\s:\-–—]+(.+)$/i, confidence: 0.9 },
      { regex: /^Module\s+(\d+)[\s:\-–—]+(.+)$/i, confidence: 0.9 },
      { regex: /^Section\s+(\d+)[\s:\-–—]+(.+)$/i, confidence: 0.8 },
      { regex: /^PART\s+(\d+)[\s:\-–—]+(.+)$/i, confidence: 0.8 },
    ]

    const lines = this.pdfText.split('\n')
    let currentIndex = 0
    let lastChapterPage = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      currentIndex = this.pdfText.indexOf(lines[i], currentIndex)

      // Skip trivial lines
      if (line.length < 4 || line.length > 100) continue

      for (const { regex, confidence } of patterns) {
        const match = line.match(regex)
        if (match) {
          const num = parseInt(match[1])
          const title = match[2].trim()
          const page = this.getPageNumber(currentIndex)

          // Context Awareness / Sanity Checks

          if (this.isStrongHeader(lines, i)) {
            // Avoid duplicate chapters on same page (e.g. running headers)
            const existing = chapters.find(c => c.chapterNumber === num)
            if (!existing) {
              chapters.push({
                chapterNumber: num,
                title: title,
                startIndex: currentIndex,
                endIndex: -1,
                startPage: page,
                endPage: -1,
              })
              lastChapterPage = page
              break // Matched pattern, move to next line
            }
          }
        }
      }
    }

    return chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)
  }

  private isStrongHeader(lines: string[], index: number): boolean {
    const line = lines[index]
    if (!line) return false

    // Check surrounding lines
    const prev = lines[index - 1]?.trim() || ''
    const next = lines[index + 1]?.trim() || ''

    // Header usually has some whitespace isolation
    const isIsolated = (!prev || prev.length < 5) || (!next || next.length < 5)

    // Header unlikely to end with typical sentence punctuation (except ? or !)
    const endsSentence = /[.,;:]$/.test(line)

    // Filter out obvious false positives like "See Chapter 5"
    const isReference = /^(see|refer to|in|read|shown in)/i.test(line)

    return !isReference && (isIsolated || !endsSentence)
  }

  private finalizeChapters(chapters: ChapterInfo[]) {
    // Sort
    chapters.sort((a, b) => a.startIndex - b.startIndex)

    // Assign End Indices
    for (let i = 0; i < chapters.length; i++) {
      if (i < chapters.length - 1) {
        chapters[i].endIndex = chapters[i + 1].startIndex - 1
        chapters[i].endPage = this.getPageNumber(chapters[i].endIndex)
      } else {
        chapters[i].endIndex = this.pdfText.length
        chapters[i].endPage = this.pageBreaks.length - 1
      }
    }
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
    //const nextLine = lineIndex < allLines.length - 1 ? allLines[lineIndex + 1].trim() : '' // unused

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
