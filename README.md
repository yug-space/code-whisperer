# Code Analyzer

A beautiful Next.js application that analyzes code line-by-line using AI, explaining each line in simple terms for beginners.

## Features

- **Line-by-line analysis** - Types out code and explanations sequentially with a terminal-style animation
- **16-year-old friendly** - Explanations use simple words and analogies, no jargon
- **Auto language detection** - Automatically detects 14+ programming languages via regex
- **Green terminal aesthetic** - Matrix-style UI with glowing text, scanlines, and vignette effects
- **Large file support** - Handles 1000+ line files by processing in batches of 150 lines
- **Streaming responses** - Results appear progressively, no waiting for full analysis

## Supported Languages

- JavaScript / TypeScript
- Python
- C / C++ / CUDA
- Java
- Go
- Rust
- Ruby
- PHP
- Swift
- Kotlin
- SQL
- Shell/Bash

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: Tailwind CSS + shadcn/ui
- **AI Model**: Claude Sonnet 4 via OpenRouter API
- **Streaming**: Server-Sent Events (SSE)

## Setup

1. Clone the repository:
```bash
git clone <repo-url>
cd code-analyzer
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` with your OpenRouter API key:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

4. Run the development server:
```bash
npm run dev
```

5. Open http://localhost:3000

## How It Works

### Analysis Flow

1. **Input** - Paste code into the textarea
2. **Language Detection** - Regex patterns detect the programming language
3. **Batching** - Large files are split into 150-line batches
4. **AI Analysis** - Each batch is sent to Claude Sonnet for explanation
5. **Streaming** - Results stream back line-by-line via SSE
6. **Animation** - Code types out with explanations appearing below each line
7. **Summary** - At completion, a side panel shows an overall explanation

### API Route (`/api/analyze`)

The API processes code in batches to handle large files:

```
POST /api/analyze
Content-Type: application/json

{
  "code": "your code here",
  "language": "detected language"
}
```

Response: Server-Sent Events stream with:
- `type: 'concept'` - Overall concept and summary
- `type: 'line'` - Individual line with explanation
- `type: 'done'` - Analysis complete
- `type: 'error'` - Error message

### Language Detection (`/lib/detectLanguage.ts`)

Uses regex patterns to identify languages without AI:
- Checks for language-specific keywords, syntax, and imports
- Falls back to JavaScript if uncertain
- Special handling for CUDA (detected as C++)

## Configuration

### Changing the AI Model

Edit `src/app/api/analyze/route.ts`:

```typescript
model: 'anthropic/claude-sonnet-4',  // Current (best quality)
model: 'anthropic/claude-3-haiku',   // Faster, cheaper
model: 'anthropic/claude-3-opus',    // Most accurate
```

### Adjusting Batch Size

```typescript
const MAX_LINES_PER_BATCH = 150;  // Increase for faster processing, decrease for reliability
```

### Customizing the UI Theme

Edit `src/app/globals.css` for colors and effects:
- Scanline overlay intensity
- Vignette darkness
- Text glow strength
- Scrollbar colors

## Testing

Run the test script:
```bash
node test-analyze.js
```

## Project Structure

```
code-analyzer/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── analyze/
│   │   │       └── route.ts      # API endpoint
│   │   ├── page.tsx              # Main UI
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # Styles
│   ├── components/
│   │   └── ui/                   # shadcn components
│   └── lib/
│       └── detectLanguage.ts     # Language detection
├── test-analyze.js               # Test script
├── .env.local                    # API keys (not committed)
└── package.json
```

## Troubleshooting

### "Could not analyze" errors
- Check your OpenRouter API key is valid
- Check server logs for JSON parsing errors
- The AI model may be overloaded - try again

### Hydration mismatch warnings
- Caused by browser extensions modifying the DOM
- Already handled with `suppressHydrationWarning`

### Large file timeouts
- Batch processing should handle files up to 1000+ lines
- If issues persist, reduce `MAX_LINES_PER_BATCH`

## License

MIT
