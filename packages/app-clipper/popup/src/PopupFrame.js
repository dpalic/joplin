import React from 'react';

const VIEWPORT_MARGIN = 20;
// Chrome never makes a toolbar popup taller than 600px, whatever the screen or the
// page asks for (verified: a 900px frame still gives a 600px window). Content
// beyond that can only scroll inside our frame, so the popup cannot grow further
// after e.g. a clip. Don't try to raise this for Chrome; Firefox has no such limit.
const CHROME_POPUP_MAX_HEIGHT = 600;
const isFirefox = navigator.userAgent.includes('Firefox');
// Used until the real browser window height is known
const DEFAULT_MAX_HEIGHT = CHROME_POPUP_MAX_HEIGHT;
const FOLLOW_UP_DELAYS = [50, 200];

const isEditingField = () => {
	const element = document.activeElement;
	return !!element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
};

// The only vertical scroller of the popup. It is exactly as high as its content
// until the available viewport height (minus a margin) is reached.
export default class PopupFrame extends React.Component {

	constructor() {
		super();

		this.frameRef = React.createRef();
		this.contentRef = React.createRef();
		this.updateHeight = this.updateHeight.bind(this);
		this.scheduleUpdate = this.scheduleUpdate.bind(this);
		this.viewportHeight = null;
		this.hadPreview = false;
	}

	maxHeight() {
		if (this.viewportHeight === null) return DEFAULT_MAX_HEIGHT;
		const fitting = this.viewportHeight - VIEWPORT_MARGIN;
		return isFirefox ? fitting : Math.min(fitting, CHROME_POPUP_MAX_HEIGHT);
	}

	// The height of the browser window the popup belongs to. It is read again on
	// every recalculation because the user may have resized the window.
	async refreshViewportHeight() {
		try {
			const api = window.browser || window.chrome;
			const browserWindow = await api.windows.getLastFocused();
			if (browserWindow && browserWindow.height) this.viewportHeight = browserWindow.height;
		} catch (error) {
			console.warn('Could not read the browser window height, keeping the last known value', error);
		}
	}

	updateHeight() {
		const frame = this.frameRef.current;
		const content = this.contentRef.current;
		if (!frame || !content) return;

		// offsetHeight rounds down, which would leave a 1px scrollbar
		const maxHeight = this.maxHeight();
		const contentHeight = Math.ceil(content.getBoundingClientRect().height);
		const height = `${Math.min(contentHeight, maxHeight)}px`;
		frame.style.maxHeight = `${maxHeight}px`;
		frame.style.height = height;

		// The clip preview appears at the bottom after a "Clip ..." click. Scroll to
		// it, but never while the user is typing in a field, and never on opening.
		const hasPreview = !!content.querySelector('.Preview');
		if (hasPreview && !this.hadPreview && !isEditingField()) {
			frame.scrollTop = frame.scrollHeight;
		}
		this.hadPreview = hasPreview;
	}

	// Content such as the clipped preview settles over several frames
	scheduleUpdate() {
		this.updateHeight();
		void this.refreshViewportHeight().then(this.updateHeight);
		window.requestAnimationFrame(this.updateHeight);
		for (const delay of FOLLOW_UP_DELAYS) {
			this.timers.push(setTimeout(this.updateHeight, delay));
		}
	}

	componentDidMount() {
		this.timers = [];
		this.scheduleUpdate();

		window.addEventListener('resize', this.scheduleUpdate);
		// Leaving an input field is when the layout most often changes (tag
		// list closes, title wraps, etc.)
		document.addEventListener('focusout', this.scheduleUpdate);

		if (window.ResizeObserver) {
			this.resizeObserver = new window.ResizeObserver(this.scheduleUpdate);
			this.resizeObserver.observe(this.contentRef.current);
		}
	}

	componentWillUnmount() {
		this.timers.forEach(clearTimeout);
		window.removeEventListener('resize', this.scheduleUpdate);
		document.removeEventListener('focusout', this.scheduleUpdate);
		if (this.resizeObserver) this.resizeObserver.disconnect();
	}

	render() {
		return (
			<div className="PopupFrame" ref={this.frameRef}>
				<div ref={this.contentRef}>
					{this.props.children}
				</div>
			</div>
		);
	}

}
