const {
	youtubeVideoId,
	youtubeTimestampToSeconds,
	youtubeTranscriptToHtml,
	youtubeChaptersFromDescription,
	youtubeChaptersToHtml,
	youtubeNoteContentsToHtml,
	youtubeThumbnailWidthValue,
	youtubeThumbnailUrl,
} = require('../content_scripts/youtubeTranscript');

const watchPage = ({ description = '', transcript = false } = {}) => `
	<ytd-watch-metadata>
		<h1>My Video</h1>
		<div id="owner"><ytd-channel-name><a href="https://www.youtube.com/@chan">Chan</a></ytd-channel-name></div>
		${description ? `<div id="description-inline-expander" is-expanded><div id="expanded"><yt-attributed-string>${description}</yt-attributed-string></div></div>` : ''}
	</ytd-watch-metadata>
	${transcript ? '<ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"><ytd-transcript-segment-renderer><div class="segment-timestamp">0:00</div><div class="segment-text">Hello</div></ytd-transcript-segment-renderer></ytd-engagement-panel-section-list-renderer>' : ''}
	<meta property="og:image" content="https://i.ytimg.com/vi/abc123/maxresdefault.jpg">`;

const chapterDescription = 'Intro<br>0:00 Start<br>1:05 Setup &amp; Tools<br>12:30 Wrap-up<br>Thanks!';

const clip = async (page, settings = {}) => {
	document.body.innerHTML = page;
	window.chrome = { storage: { local: { get: async () => settings } } };
	return window.processYoutubeClip('<html>full page</html>');
};

describe('youtubeTranscript', () => {

	test.each([
		['https://www.youtube.com/watch?v=abc123', 'abc123'],
		['https://m.youtube.com/watch?v=abc123&t=5', 'abc123'],
		['https://www.youtube.com/shorts/abc123', null],
		['https://example.com/watch?v=abc123', null],
		['not a url', null],
	])('reads the video id of %s', (url, expected) => {
		expect(youtubeVideoId(url)).toBe(expected);
	});

	test.each([
		['0:00', 0],
		['1:05', 65],
		['1:02:03', 3723],
		['x:yy', 0],
	])('converts the timestamp %s to seconds', (timestamp, expected) => {
		expect(youtubeTimestampToSeconds(timestamp)).toBe(expected);
	});

	test.each([
		[{ youtubeThumbnailWidthMode: 'percentage', youtubeThumbnailWidthPercentage: 40 }, '40%'],
		[{ youtubeThumbnailWidthMode: 'percentage', youtubeThumbnailWidthPercentage: 500 }, '100%'],
		[{ youtubeThumbnailWidthMode: 'percentage', youtubeThumbnailWidthPercentage: 'abc' }, '40%'],
		[{ youtubeThumbnailWidthMode: 'absolute', youtubeThumbnailWidthPixels: 320 }, '320'],
		[{ youtubeThumbnailWidthMode: 'absolute', youtubeThumbnailWidthPixels: 99999 }, '4000'],
	])('computes the thumbnail width for %j', (settings, expected) => {
		expect(youtubeThumbnailWidthValue(settings)).toBe(expected);
	});

	test('uses the page thumbnail only if it belongs to the video', () => {
		expect(youtubeThumbnailUrl('abc123', 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg')).toBe('https://i.ytimg.com/vi/abc123/maxresdefault.jpg');
		expect(youtubeThumbnailUrl('abc123', 'https://i.ytimg.com/vi/other/maxresdefault.jpg')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
		expect(youtubeThumbnailUrl('abc123', '')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
	});

	test('builds the transcript with timestamp links', () => {
		const html = youtubeTranscriptToHtml([{ timestamp: '1:05', text: 'A & B' }], 'abc123');
		expect(html).toBe('<a id="transcript"></a><h2>Transcript</h2><p><a href="https://www.youtube.com/watch?v=abc123&amp;t=65s">1:05</a> A &amp; B</p>');
	});

	test('drops the whole transcript when a timestamp is invalid or nothing is spoken', () => {
		expect(youtubeTranscriptToHtml([{ timestamp: '0:00', text: 'ok' }, { timestamp: 'junk', text: 'bad' }], 'abc123')).toBe('');
		expect(youtubeTranscriptToHtml([{ timestamp: '0:00', text: '' }], 'abc123')).toBe('');
	});

	describe('chapters', () => {
		test('reads chapters from the description and links them', () => {
			const html = youtubeChaptersToHtml(youtubeChaptersFromDescription(chapterDescription), 'abc123');
			expect(html).toContain('<h3>Video Content</h3>');
			expect(html).toContain('<a href="https://www.youtube.com/watch?v=abc123&amp;t=65s">1:05</a> Setup &amp; Tools');
		});

		test.each([
			['fewer than three chapters', '0:00 a<br>2:00 b'],
			['no chapter at 0:00', '1:00 a<br>2:00 b<br>3:00 c'],
		])('ignores %s', (_name, description) => {
			expect(youtubeChaptersFromDescription(description)).toEqual([]);
		});

		test('returns nothing without chapters', () => {
			expect(youtubeChaptersToHtml([], 'abc123')).toBe('');
		});
	});

	describe('note table of contents', () => {
		test('nests the subsections', () => {
			const html = youtubeNoteContentsToHtml([
				{ anchor: 'description', title: 'Description', children: [{ anchor: 'content', title: 'Content' }, { anchor: 'video-content', title: 'Video Content' }] },
				{ anchor: 'transcript', title: 'Transcript' },
			]);
			expect(html).toBe('<h2>Table of Contents</h2><ul><li><a href="#description">Description</a><ul><li><a href="#content">Content</a></li><li><a href="#video-content">Video Content</a></li></ul></li><li><a href="#transcript">Transcript</a></li></ul>');
		});

		test.each([
			['a single section without subsections', [{ anchor: 'transcript', title: 'Transcript' }]],
			['a single section with one subsection', [{ anchor: 'description', title: 'Description', children: [{ anchor: 'content', title: 'Content' }] }]],
		])('is omitted for %s', (_name, sections) => {
			expect(youtubeNoteContentsToHtml(sections)).toBe('');
		});
	});

	describe('processYoutubeClip', () => {
		test('puts the table of contents after the channel and returns the anchors', async () => {
			const result = await clip(watchPage({ description: chapterDescription, transcript: true }));
			expect(result.anchorNames).toEqual(['description', 'video-content', 'content', 'transcript']);
			const order = ['Channel:', 'Table of Contents', '<h2>Description</h2>', '<h3>Video Content</h3>', '<h3>Content</h3>', '<h2>Transcript</h2>'].map(text => result.html.indexOf(text));
			expect(order.every(index => index >= 0)).toBe(true);
			expect(order).toEqual([...order].sort((a, b) => a - b));
		});

		test('adds an empty Related Information chapter between Description and Transcript', async () => {
			const result = await clip(watchPage({ description: chapterDescription, transcript: true }), { youtubeAddRelatedInformation: true });
			expect(result.html).toContain('<a id="description"></a><h2>Description</h2>');
			expect(result.html).toContain('<a id="related-information"></a><h2>Related Information</h2><a id="transcript"></a><h2>Transcript</h2>');
			expect(result.html.indexOf('<h2>Description</h2>')).toBeLessThan(result.html.indexOf('<h2>Related Information</h2>'));
			expect(result.html).toContain('<li><a href="#related-information">Related Information</a></li>');
			expect(result.anchorNames).toContain('related-information');
		});

		test.each([
			[{ youtubeSummaryTitle: 'Summary' }, 'Summary'],
			[{}, 'AI generated Summary'],
			[{ youtubeSummaryTitle: '<script>' }, 'AI generated Summary'],
		])('adds an empty summary chapter before Video Content for %j', async (settings, title) => {
			const result = await clip(watchPage({ description: chapterDescription }), { youtubeAddSummary: true, youtubeFetchTranscription: false, ...settings });
			expect(result.html).toContain(`<h2>Description</h2><a id="summary"></a><h3>${title}</h3><a id="video-content"></a><h3>Video Content</h3>`);
			expect(result.html.indexOf('href="#summary"')).toBeLessThan(result.html.indexOf('href="#video-content"'));
			expect(result.anchorNames.slice(0, 3)).toEqual(['description', 'summary', 'video-content']);
		});

		test('creates the Description chapter for the summary even without a description', async () => {
			const result = await clip(watchPage(), { youtubeAddSummary: true, youtubeFetchTranscription: false });
			expect(result.html).toContain('<h2>Description</h2><a id="summary"></a><h3>AI generated Summary</h3>');
		});

		test('adds no Summary chapter by default', async () => {
			const result = await clip(watchPage({ description: chapterDescription, transcript: true }));
			expect(result.html).not.toContain('Summary');
		});

		test('adds no Related Information chapter by default', async () => {
			const result = await clip(watchPage({ description: chapterDescription, transcript: true }));
			expect(result.html).not.toContain('Related Information');
		});

		test('keeps the video content without a table of contents when there is no transcript and no chapters', async () => {
			const result = await clip(watchPage({ description: 'Just text' }), { youtubeFetchTranscription: false });
			expect(result.html).toContain('<h3>Content</h3>');
			expect(result.html).not.toContain('Table of Contents');
			expect(result.anchorNames).toEqual([]);
		});

		test('adds only the transcript when the video content is off', async () => {
			const result = await clip(watchPage({ transcript: true }), { youtubeOnlyVideoContent: false });
			expect(result.html).toMatch(/^<html>full page<\/html><a id="transcript"><\/a><h2>Transcript<\/h2>/);
			expect(result.anchorNames).toEqual([]);
		});

		test('returns the page unchanged when both options are off', async () => {
			const result = await clip(watchPage(), { youtubeOnlyVideoContent: false, youtubeFetchTranscription: false });
			expect(result).toMatchObject({ html: '<html>full page</html>', anchorNames: [] });
		});

		test('warns when the video details are missing', async () => {
			const result = await clip('', { youtubeFetchTranscription: false });
			expect(result.warning).toContain('Could not read the YouTube video details');
		});
	});

});
