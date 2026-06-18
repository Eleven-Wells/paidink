const AVG_WORDS_PER_MINUTE = 200;
const SECONDS_PER_IMAGE = 12;

function stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/[#*_~>`\-|]/g, '')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

function getReadTime(content, options = {}) {
  if (!content) return { minutes: 0, display: '< 1 min read' };

  const { wpm = AVG_WORDS_PER_MINUTE, countImages = true } = options;
  const text = stripMarkdown(content);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const imageCount = countImages
    ? (content.match(/!\[.*?\]\(.*?\)/g) || []).length
    : 0;

  const minutes = Math.ceil(wordCount / wpm + (imageCount * SECONDS_PER_IMAGE) / 60);

  if (minutes < 1) return { minutes: 0, display: '< 1 min read' };

  return { minutes, display: `~${minutes} min read` };
}

module.exports = { getReadTime };
