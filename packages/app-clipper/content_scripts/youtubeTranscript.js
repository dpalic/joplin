/* eslint-disable no-console */

// YouTube no longer serves caption files to scripts, so the transcript is read from the page's "Show transcript" panel.
// The popup re-injects this script on every open, so it is wrapped in a function to avoid duplicate top-level const errors.

(function() {

	const youtubeSettingDefaults = {
		youtubeFetchTranscription: true,
		youtubeOnlyVideoContent: true,
		youtubeThumbnailWidthMode: 'percentage',
		youtubeThumbnailWidthPercentage: 40,
		youtubeThumbnailWidthPixels: 500,
	};

	const youtubeSegmentSelector = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
	const youtubePanelSelector = 'ytd-engagement-panel-section-list-renderer';
	const youtubeExpandedPanelSelector = `${youtubePanelSelector}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`;
	const youtubeTranscriptLoadTimeoutMs = 6000;
	const youtubeDescriptionAnchor = 'description';
	const youtubeTranscriptAnchor = 'transcript';
	const youtubeVideoContentAnchor = 'video-content';
	const youtubeContentAnchor = 'content';
	const youtubeTimestampPattern = /^\d+(:\d{2}){1,2}$/;

	function youtubeEscapeHtml(s) {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function youtubeVideoId(url) {
		let parsed = null;
		try {
			parsed = new URL(url);
		} catch (error) {
			return null;
		}
		const isYoutube = parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com');
		if (!isYoutube || parsed.pathname !== '/watch') return null;
		return parsed.searchParams.get('v');
	}

	function youtubeTimestampToSeconds(timestamp) {
		const parts = timestamp.split(':').map(Number);
		if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
		return parts.reduce((total, n) => total * 60 + n, 0);
	}

	function youtubeWatchUrl(videoId, seconds = 0) {
		const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
		return seconds ? `${url}&t=${seconds}s` : url;
	}

	function youtubeThumbnailWidthValue(settings) {
		const number = (value, fallback, max) => {
			const n = Math.round(Number(value));
			return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
		};
		if (settings.youtubeThumbnailWidthMode === 'absolute') {
			return String(number(settings.youtubeThumbnailWidthPixels, youtubeSettingDefaults.youtubeThumbnailWidthPixels, 4000));
		}
		return `${number(settings.youtubeThumbnailWidthPercentage, youtubeSettingDefaults.youtubeThumbnailWidthPercentage, 100)}%`;
	}

	// The page's og:image can be left over from the previous video after in-page navigation,
	// so it is only used if it belongs to this video.
	function youtubeThumbnailUrl(videoId, ogImageUrl) {
		const belongsToVideo = !!ogImageUrl
			&& ogImageUrl.startsWith('https://i.ytimg.com/vi/')
			&& ogImageUrl.includes(`/vi/${videoId}/`);
		return belongsToVideo ? ogImageUrl : `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
	}

	// All or nothing: one unreadable timestamp means the page markup is not what
	// we expect, so no transcript is better than one with wrong links.
	function youtubeTranscriptToHtml(segments, videoId) {
		const spoken = segments.filter(segment => segment.text);
		if (!spoken.length || !spoken.every(segment => youtubeTimestampPattern.test(segment.timestamp))) return '';

		const lines = spoken.map((segment) => {
			const href = youtubeWatchUrl(videoId, youtubeTimestampToSeconds(segment.timestamp));
			return `<p><a href="${youtubeEscapeHtml(href)}">${youtubeEscapeHtml(segment.timestamp)}</a> ${youtubeEscapeHtml(segment.text)}</p>`;
		});
		return `<a id="${youtubeTranscriptAnchor}"></a><h2>Transcript</h2>${lines.join('')}`;
	}

	// YouTube itself only treats description lines starting with a timestamp as chapters if the
	// first one is at 0:00 and there are at least three, so other timestamp mentions are ignored.
	function youtubeValidChapters(chapters) {
		const isValid = chapters.length >= 3 && youtubeTimestampToSeconds(chapters[0].timestamp) === 0;
		return isValid ? chapters : [];
	}

	function youtubeChaptersFromDescription(descriptionHtml) {
		const parser = new DOMParser();
		const chapterLine = /^[\s•*-]*(\d+(?::\d{2}){1,2})[\s\-–—:|.)]*(\S.*)$/;
		const chapters = descriptionHtml.split('<br>')
			.map(line => parser.parseFromString(line, 'text/html').body.textContent.trim().match(chapterLine))
			.filter(Boolean)
			.map(match => ({ timestamp: match[1], title: match[2].trim() }));
		return youtubeValidChapters(chapters);
	}

	// The chapters YouTube lists next to the player. They also cover chapters that YouTube
	// created itself and that are not written in the description.
	function youtubeChaptersFromPanel() {
		const chapters = Array.from(document.querySelectorAll('ytd-macro-markers-list-item-renderer')).map(item => ({
			timestamp: youtubeCleanText(item.querySelector('#time')),
			title: youtubeCleanText(item.querySelector('#details h4, h4')),
		}));
		return youtubeValidChapters(chapters.filter(chapter => youtubeTimestampPattern.test(chapter.timestamp) && chapter.title));
	}

	function youtubeChaptersToHtml(chapters, videoId) {
		if (!chapters.length) return '';
		const items = chapters.map((chapter) => {
			const href = youtubeWatchUrl(videoId, youtubeTimestampToSeconds(chapter.timestamp));
			return `<li><a href="${youtubeEscapeHtml(href)}">${youtubeEscapeHtml(chapter.timestamp)}</a> ${youtubeEscapeHtml(chapter.title)}</li>`;
		});
		return `<a id="${youtubeVideoContentAnchor}"></a><h3>Video Content</h3><ul>${items.join('')}</ul>`;
	}

	function youtubeNoteContentsToHtml(sections) {
		const hasSeveralEntries = sections.length >= 2 || sections.some(section => (section.children || []).length >= 2);
		if (!hasSeveralEntries) return '';
		const link = section => `<a href="#${section.anchor}">${section.title}</a>`;
		const items = sections.map((section) => {
			const children = section.children || [];
			const nested = children.length ? `<ul>${children.map(child => `<li>${link(child)}</li>`).join('')}</ul>` : '';
			return `<li>${link(section)}${nested}</li>`;
		});
		return `<h2>Table of Contents</h2><ul>${items.join('')}</ul>`;
	}

	function youtubeSleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async function youtubeWaitFor(condition, timeoutMs, intervalMs = 150) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const result = condition();
			if (result) return result;
			await youtubeSleep(intervalMs);
		}
		return condition();
	}

	function youtubeCleanText(element) {
		return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
	}

	function youtubeNodeToHtml(node) {
		if (node.nodeType === Node.TEXT_NODE) {
			return youtubeEscapeHtml(node.textContent).replace(/\n/g, '<br>');
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return '';
		const inner = Array.from(node.childNodes).map(youtubeNodeToHtml).join('');
		if (node.tagName === 'BR') return '<br>';
		if (node.tagName === 'A' && node.href) return `<a href="${youtubeEscapeHtml(node.href)}">${inner}</a>`;
		return inner;
	}

	async function youtubeGetSettings() {
		try {
			// eslint-disable-next-line no-undef
			const api = typeof browser !== 'undefined' ? browser : chrome;
			const stored = await api.storage.local.get(Object.keys(youtubeSettingDefaults));
			return { ...youtubeSettingDefaults, ...stored };
		} catch (error) {
			console.warn('jopext: Could not read the YouTube settings', error);
			return { ...youtubeSettingDefaults };
		}
	}

	async function youtubeReadDescriptionHtml(metadata) {
		const expander = metadata.querySelector('#description-inline-expander');
		if (!expander) return '';

		const wasExpanded = expander.hasAttribute('is-expanded');
		if (!wasExpanded) expander.querySelector('#expand')?.click();

		try {
			const description = await youtubeWaitFor(() => {
				const element = expander.querySelector('#expanded yt-attributed-string');
				return element && element.textContent.trim() ? element : null;
			}, 1500);

			return description ? youtubeNodeToHtml(description).trim() : '';
		} finally {
			if (!wasExpanded) expander.querySelector('#collapse')?.click();
		}
	}

	async function youtubeVideoContentHtml(videoId, settings) {
		const metadata = document.querySelector('ytd-watch-metadata');
		if (!metadata) return { html: '', headHtml: '', descriptionHtml: '', title: '', imageSizes: {} };

		const title = youtubeCleanText(metadata.querySelector('h1'));
		const channel = metadata.querySelector('#owner ytd-channel-name a');
		const description = await youtubeReadDescriptionHtml(metadata);

		const thumbnailUrl = youtubeThumbnailUrl(videoId, document.querySelector('meta[property="og:image"]')?.content);
		const watchUrl = youtubeWatchUrl(videoId);

		// A line holding only a YouTube link becomes a full-width player in Joplin, so the link is
		// preceded by text and the thumbnail is a separate image.
		const parts = [];
		if (title) parts.push(`<h1>${youtubeEscapeHtml(title)}</h1>`);
		parts.push(`<p><img src="${youtubeEscapeHtml(thumbnailUrl)}" alt="Video thumbnail"></p>`);
		parts.push(`<p>Video: <a href="${youtubeEscapeHtml(watchUrl)}">${youtubeEscapeHtml(watchUrl)}</a></p>`);
		if (channel) {
			parts.push(`<p>Channel: <a href="${youtubeEscapeHtml(channel.href)}">${youtubeEscapeHtml(youtubeCleanText(channel))}</a></p>`);
		}
		const chapters = youtubeChaptersFromDescription(description);
		const chaptersHtml = youtubeChaptersToHtml(chapters.length ? chapters : youtubeChaptersFromPanel(), videoId);
		const headHtml = parts.join('');
		let descriptionHtml = '';
		if (description || chaptersHtml) {
			descriptionHtml = `<a id="${youtubeDescriptionAnchor}"></a><h2>Description</h2>${chaptersHtml}${description ? `<a id="${youtubeContentAnchor}"></a><h3>Content</h3><p>${description}</p>` : ''}`;
		}

		// Joplin writes these sizes into the <img> tag as they are (replaceUrlsByResources in the
		// clipper REST route), which allows a percentage width.
		const imageSizes = {
			[thumbnailUrl]: [{ width: youtubeThumbnailWidthValue(settings), height: 'auto', naturalWidth: 0, naturalHeight: 0 }],
		};
		return { html: headHtml + descriptionHtml, headHtml, descriptionHtml, title, imageSizes };
	}

	function youtubeReadSegment(element) {
		const timestamp = youtubeCleanText(element.querySelector('.segment-timestamp, [aria-hidden="true"]'));
		const text = youtubeCleanText(element.querySelector('.segment-text, [role="text"]'));
		return { timestamp, text };
	}

	function youtubeCloseNewPanels(panelsBefore) {
		for (const panel of document.querySelectorAll(youtubeExpandedPanelSelector)) {
			if (!panelsBefore.includes(panel)) panel.querySelector('#visibility-button button')?.click();
		}
	}

	async function youtubeClickShowTranscript() {
		const metadata = document.querySelector('ytd-watch-metadata');
		const findButton = () => metadata?.querySelector('ytd-video-description-transcript-section-renderer button');
		let button = findButton();
		if (!button) {
			metadata?.querySelector('#description-inline-expander #expand')?.click();
			button = await youtubeWaitFor(findButton, 1500);
		}
		if (!button) return false;
		button.click();
		return true;
	}

	async function youtubeReadPanelSegments() {
		const first = await youtubeWaitFor(() => document.querySelector(youtubeSegmentSelector), youtubeTranscriptLoadTimeoutMs);
		const panel = first?.closest(youtubePanelSelector);
		if (!panel) return null;

		let count = -1;
		await youtubeWaitFor(() => {
			const current = panel.querySelectorAll(youtubeSegmentSelector).length;
			const stable = current === count;
			count = current;
			return stable;
		}, 2000, 300);

		return Array.from(panel.querySelectorAll(youtubeSegmentSelector)).map(youtubeReadSegment);
	}

	async function youtubeReadTranscriptSegments() {
		if (document.querySelector(youtubeSegmentSelector)) return youtubeReadPanelSegments();

		const panelsBefore = Array.from(document.querySelectorAll(youtubeExpandedPanelSelector));
		try {
			if (!await youtubeClickShowTranscript()) return null;
			return await youtubeReadPanelSegments();
		} finally {
			youtubeCloseNewPanels(panelsBefore);
		}
	}

	async function processYoutubeClip(clipHtml) {
		const unchanged = { html: clipHtml, title: '', warning: '', imageSizes: {}, anchorNames: [] };

		const videoId = youtubeVideoId(window.location.href);
		if (!videoId) return unchanged;

		const settings = await youtubeGetSettings();
		if (!settings.youtubeOnlyVideoContent && !settings.youtubeFetchTranscription) return unchanged;

		const warnings = [];
		let html = clipHtml;
		let title = '';
		let imageSizes = {};
		let videoContent = null;

		if (settings.youtubeOnlyVideoContent) {
			const videoDetailsWarning = 'Could not read the YouTube video details - the full page has been saved instead.';
			try {
				const content = await youtubeVideoContentHtml(videoId, settings);
				if (content.html) {
					html = content.html;
					videoContent = content;
					title = content.title;
					imageSizes = content.imageSizes;
				} else {
					warnings.push(videoDetailsWarning);
				}
			} catch (error) {
				console.warn('jopext: Could not read the YouTube video details', error);
				warnings.push(videoDetailsWarning);
			}
		}

		const sections = [];
		if (videoContent && videoContent.descriptionHtml) {
			const children = [];
			if (videoContent.descriptionHtml.includes(`id="${youtubeVideoContentAnchor}"`)) children.push({ anchor: youtubeVideoContentAnchor, title: 'Video Content' });
			if (videoContent.descriptionHtml.includes(`id="${youtubeContentAnchor}"`)) children.push({ anchor: youtubeContentAnchor, title: 'Content' });
			sections.push({ anchor: youtubeDescriptionAnchor, title: 'Description', children });
		}

		if (settings.youtubeFetchTranscription) {
			try {
				const segments = await youtubeReadTranscriptSegments();
				const transcriptHtml = segments ? youtubeTranscriptToHtml(segments, videoId) : '';
				if (transcriptHtml) {
					html += transcriptHtml;
					sections.push({ anchor: youtubeTranscriptAnchor, title: 'Transcript' });
				} else {
					warnings.push('No transcript was found for this YouTube video.');
				}
			} catch (error) {
				console.warn('jopext: Could not read the YouTube transcript', error);
				warnings.push('Could not read the YouTube transcript.');
			}
		}

		const contentsHtml = youtubeNoteContentsToHtml(sections);
		if (contentsHtml && videoContent) {
			html = videoContent.headHtml + contentsHtml + html.slice(videoContent.headHtml.length);
		}

		return { html, title, warning: warnings.join(' '), imageSizes, anchorNames: contentsHtml ? sections.flatMap(section => [section.anchor, ...(section.children || []).map(child => child.anchor)]) : [] };
	}

	if (typeof window !== 'undefined') window.processYoutubeClip = processYoutubeClip;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			youtubeVideoId,
			youtubeTimestampToSeconds,
			youtubeTranscriptToHtml,
			youtubeChaptersFromDescription,
			youtubeChaptersToHtml,
			youtubeNoteContentsToHtml,
			youtubeThumbnailWidthValue,
			youtubeThumbnailUrl,
		};
	}

})();
