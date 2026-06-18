const { getReadTime } = require('../../src/services/ReadTimeService');

describe('ReadTimeService', () => {
  describe('getReadTime', () => {
    test('returns < 1 min read for empty content', () => {
      const result = getReadTime('');
      expect(result.minutes).toBe(0);
      expect(result.display).toBe('< 1 min read');
    });

    test('returns < 1 min read for null content', () => {
      expect(getReadTime(null).display).toBe('< 1 min read');
    });

    test('returns < 1 min read for undefined content', () => {
      expect(getReadTime(undefined).display).toBe('< 1 min read');
    });

    test('returns ~1 min read for very short content', () => {
      const content = 'short content here';
      const result = getReadTime(content);
      expect(result.display).toBe('~1 min read');
    });

    test('returns ~X min read for typical article', () => {
      const words = Array(200).fill('word').join(' ');
      const content = `# Title\n\n${words}`;
      const result = getReadTime(content);
      expect(result.display).toMatch(/^~\d+ min read$/);
      expect(result.minutes).toBeGreaterThanOrEqual(1);
    });

    test('strips markdown code blocks before counting', () => {
      const code = '```js\nconst x = 1;\nconst y = 2;\n```';
      const text = 'A short paragraph.';
      const mixed = `${text}\n\n${code}`;
      const textOnly = getReadTime(text);
      const mixedResult = getReadTime(mixed);
      expect(mixedResult.minutes).toBe(textOnly.minutes);
    });

    test('strips markdown links but keeps link text', () => {
      const content = 'Read [this article](https://example.com) for more info';
      const result = getReadTime(content);
      expect(result.minutes).toBeGreaterThanOrEqual(1);
    });

    test('accounts for images in estimate', () => {
      const noImages = 'Just a short paragraph of text here.';
      const withImages = noImages + '\n\n![alt](image1.png)\n\n![alt2](image2.png)';
      const noImgResult = getReadTime(noImages);
      const withImgResult = getReadTime(withImages);
      expect(withImgResult.minutes).toBeGreaterThanOrEqual(noImgResult.minutes);
    });

    test('defaults to 200 wpm', () => {
      const content = Array(400).fill('word').join(' ');
      const result = getReadTime(content);
      expect(result.minutes).toBe(2); // 400/200 = 2
    });
  });
});
