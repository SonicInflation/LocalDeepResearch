/**
 * PDF Export Service
 * Generates clean, professional PDF reports with selectable text and clickable links.
 *
 * In Electron: Uses native Chromium printToPDF via a hidden BrowserWindow.
 * In browser: Falls back to window.print() in a popup window.
 */

import type { ResearchReport, ResearchSource } from './researchOrchestrator';

// Extend Window type for Electron IPC
declare global {
    interface Window {
        electronAPI?: {
            printToPdf: (html: string, defaultFilename: string) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
        };
    }
}

/**
 * Convert basic markdown to HTML for PDF rendering.
 */
function markdownToHtml(md: string, sources: ResearchSource[]): string {
    let html = md;

    // Escape HTML
    html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Make inline citations [N] clickable
    html = html.replace(
        /(?<!<a[^>]*)\[(\d+)\](?!\()/g,
        (_match, num: string) => {
            const idx = parseInt(num) - 1;
            const source = sources[idx];
            if (source?.url) {
                return `<a href="${source.url}" class="citation">[${num}]</a>`;
            }
            return `[${num}]`;
        }
    );

    // Unordered lists
    html = html.replace(/^(\s*)[-*] (.+)$/gm, (_match, _indent: string, content: string) => {
        return `<li>${content}</li>`;
    });

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="ordered">$1</li>');

    // Wrap consecutive <li> items
    html = html.replace(/((?:<li(?:\s[^>]*)?>.*<\/li>\n?)+)/g, (match) => {
        if (match.includes('class="ordered"')) {
            return `<ol>${match}</ol>`;
        }
        return `<ul>${match}</ul>`;
    });

    // Tables
    html = html.replace(
        /^(\|.+\|)\n(\|[-\s|:]+\|)\n((?:\|.+\|\n?)+)/gm,
        (_match, headerRow: string, _separator: string, bodyRows: string) => {
            const headers = headerRow.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
            const rows = bodyRows.trim().split('\n').map((row: string) => {
                const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
        }
    );

    // Paragraphs
    const lines = html.split('\n');
    const result: string[] = [];
    let inParagraph = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const isBlock = /^<(h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|hr|pre|div)/.test(trimmed);
        const isClosing = /^<\/(ul|ol|table|thead|tbody|tr)>/.test(trimmed);

        if (trimmed === '') {
            if (inParagraph) { result.push('</p>'); inParagraph = false; }
        } else if (isBlock || isClosing) {
            if (inParagraph) { result.push('</p>'); inParagraph = false; }
            result.push(trimmed);
        } else {
            if (!inParagraph) { result.push('<p>'); inParagraph = true; }
            result.push(trimmed);
        }
    }
    if (inParagraph) result.push('</p>');

    return result.join('\n');
}

/**
 * Build a complete, self-contained HTML document for PDF rendering.
 * This is loaded in its own BrowserWindow so full document tags are correct.
 */
function buildPdfDocument(report: ResearchReport): string {
    const date = report.generatedAt.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const time = report.generatedAt.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit'
    });

    const sectionsHtml = report.sections
        .filter(section => section.title.toLowerCase() !== 'references')
        .map(section => {
            // Strip duplicate header if the content starts with the same title
            let content = section.content;
            const headerPatterns = [
                new RegExp(`^#{1,3}\\s*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n`, 'i'),
                new RegExp(`^\\*\\*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*\\s*\n`, 'i'),
            ];
            for (const pattern of headerPatterns) {
                content = content.replace(pattern, '');
            }
            const contentHtml = markdownToHtml(content, report.sources);
            return `<div class="section"><h2>${section.title}</h2>${contentHtml}</div>`;
        }).join('\n');

    const sourcesHtml = report.sources.map((source, i) => `
        <div class="source-entry">
            <span class="source-num">[${i + 1}]</span>
            <div class="source-detail">
                <a href="${source.url}" class="source-name">${source.title}</a>
                <div class="source-url">${source.url}</div>
            </div>
        </div>
    `).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    @page {
        size: A4;
        margin: 15mm 15mm 20mm 15mm;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 11pt;
        line-height: 1.7;
        color: #1a1a1a;
        background: #fff;
    }

    /* ---- Cover ---- */
    .cover {
        text-align: center;
        padding: 50px 30px 35px;
        border-bottom: 3px solid #2563eb;
        margin-bottom: 28px;
    }

    .cover .logo {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt;
        color: #2563eb;
        text-transform: uppercase;
        letter-spacing: 2.5px;
        margin-bottom: 20px;
    }

    .cover h1 {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 24pt;
        font-weight: 700;
        color: #111827;
        margin-bottom: 14px;
        line-height: 1.25;
    }

    .cover .subtitle {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 11pt;
        color: #6b7280;
        margin-bottom: 6px;
    }

    .cover .meta {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 10pt;
        color: #9ca3af;
    }

    /* ---- Sections ---- */
    .section {
        margin-bottom: 22px;
    }

    /* Keep headings with their content */
    .section h2, .section h3 {
        page-break-after: avoid;
    }

    .section h2 {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 15pt;
        font-weight: 700;
        color: #1e3a5f;
        margin-bottom: 10px;
        padding-bottom: 5px;
        border-bottom: 1px solid #e5e7eb;
    }

    .section h3 {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 12.5pt;
        font-weight: 600;
        color: #374151;
        margin: 16px 0 8px;
    }

    p { margin-bottom: 9px; text-align: justify; }

    strong { font-weight: 700; color: #111827; }
    em { font-style: italic; }

    code {
        font-family: 'Courier New', monospace;
        font-size: 9.5pt;
        background: #f3f4f6;
        padding: 1px 4px;
        border-radius: 3px;
    }

    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Citation links */
    a.citation {
        color: #2563eb;
        font-weight: 600;
        font-size: 0.85em;
        vertical-align: super;
        line-height: 0;
        text-decoration: underline;
    }

    /* ---- Lists ---- */
    ul, ol { margin: 8px 0 12px 24px; }
    li { margin-bottom: 4px; }

    /* ---- Blockquotes ---- */
    blockquote {
        border-left: 3px solid #2563eb;
        padding-left: 14px;
        margin: 12px 0;
        color: #4b5563;
        font-style: italic;
    }

    /* ---- Tables ---- */
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0;
        font-size: 10pt;
    }

    th, td {
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        text-align: left;
    }

    th {
        background: #f3f4f6;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-weight: 600;
        color: #374151;
    }

    hr { border: none; border-top: 1px solid #e5e7eb; margin: 18px 0; }

    /* ---- References ---- */
    .sources-section {
        margin-top: 28px;
        padding-top: 18px;
        border-top: 2px solid #2563eb;
        page-break-before: auto;
    }

    .sources-section h2 {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 15pt;
        font-weight: 700;
        color: #1e3a5f;
        margin-bottom: 14px;
        padding-bottom: 5px;
        border-bottom: 1px solid #e5e7eb;
    }

    .source-entry {
        display: flex;
        gap: 8px;
        margin-bottom: 7px;
        font-size: 9pt;
        line-height: 1.5;
    }

    .source-num {
        font-weight: 700;
        color: #2563eb;
        flex-shrink: 0;
        min-width: 26px;
    }

    .source-detail { flex: 1; min-width: 0; }
    .source-name { font-weight: 600; color: #374151; }
    .source-url { color: #6b7280; font-size: 8pt; word-break: break-all; }

    /* ---- Footer ---- */
    .footer {
        margin-top: 36px;
        padding-top: 14px;
        border-top: 1px solid #e5e7eb;
        text-align: center;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 8pt;
        color: #9ca3af;
    }

    /* Print-specific overrides */
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .section { page-break-inside: avoid; }
    }
</style>
</head>
<body>
    <div class="cover">
        <div class="logo">Local Deep Research</div>
        <h1>${report.query}</h1>
        <div class="subtitle">Comprehensive Research Report</div>
        <div class="meta">${date} at ${time} &middot; ${report.sources.length} sources analyzed</div>
    </div>

    ${sectionsHtml}

    <div class="sources-section">
        <h2>References</h2>
        ${sourcesHtml}
    </div>

    <div class="footer">
        Generated by Local Deep Research &middot; ${date}
    </div>
</body>
</html>`;
}

function getFilename(query: string): string {
    const sanitized = query
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 50);
    return `research_${sanitized}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

/**
 * Export via Electron's native printToPDF (selectable text + clickable links).
 */
async function exportViaElectron(
    html: string,
    filename: string,
    onProgress?: (status: string) => void
): Promise<void> {
    onProgress?.('Opening save dialog...');

    const result = await window.electronAPI!.printToPdf(html, filename);

    if (result.canceled) {
        onProgress?.('Export cancelled');
        return;
    }

    if (!result.success) {
        throw new Error('PDF generation failed');
    }

    onProgress?.('PDF saved!');
}

/**
 * Fallback: open a print-ready window (for non-Electron environments).
 * The user can "Save as PDF" from the browser print dialog.
 */
function exportViaPrint(html: string, onProgress?: (status: string) => void): void {
    onProgress?.('Opening print dialog...');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        throw new Error('Could not open print window. Please allow popups.');
    }

    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
            onProgress?.('Print dialog opened');
        }, 300);
    };
}

/**
 * Export a research report as a professionally formatted PDF.
 * Automatically uses Electron native rendering if available,
 * otherwise falls back to browser print.
 */
export async function exportReportAsPdf(
    report: ResearchReport,
    onProgress?: (status: string) => void
): Promise<void> {
    onProgress?.('Preparing document...');

    const html = buildPdfDocument(report);
    const filename = getFilename(report.query);

    if (window.electronAPI?.printToPdf) {
        await exportViaElectron(html, filename, onProgress);
    } else {
        exportViaPrint(html, onProgress);
    }
}
