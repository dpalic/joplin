import React, { Component } from 'react';
import './App.css';
import led_red from './led_red.png';
import led_green from './led_green.png';
import led_orange from './led_orange.png';
import TagInput, { compareTags, isSameTag } from './TagInput';
import FavouriteSets from './FavouriteSets';

const { connect } = require('react-redux');
const { bridge } = require('./bridge');

function commandUserString(command) {
	const s = [];

	if (command.name === 'simplifiedPageHtml') s.push('Simplified page');
	if (command.name === 'completePageHtml') s.push('Complete page');
	if (command.name === 'selectedHtml') s.push('Selection');
	if (command.name === 'pageUrl') s.push('URL only');

	const p = command.preProcessFor ? command.preProcessFor : 'markdown';
	s.push(`(${p})`);

	return s.join(' ');
}

class PreviewComponent extends React.PureComponent {

	constructor() {
		super();

		this.bodyRef = React.createRef();
		this.titleRef = React.createRef();
	}

	resizeTitle() {
		const title = this.titleRef.current;
		if (!title) return;
		title.style.height = 'auto';
		title.style.height = `${title.scrollHeight + title.offsetHeight - title.clientHeight}px`;
	}

	componentDidUpdate() {
		this.resizeTitle();
	}

	componentDidMount() {
		this.resizeTitle();
		if (!this.bodyRef.current) return;

		// Because the text size is made twice smaller with CSS, we need
		// to also reduce the size of the images
		const imgs = this.bodyRef.current.getElementsByTagName('img');
		for (const img of imgs) {
			img.width /= 2;
			img.height /= 2;
		}
	}

	render() {
		return (
			<div className="Preview">
				<div className="PreviewTitle">
					<label htmlFor="clipTitle">Title</label>
					<textarea
						id="clipTitle"
						ref={this.titleRef}
						className="Title"
						rows={1}
						value={this.props.title}
						onChange={this.props.onTitleChange}
						onKeyDown={event => event.key === 'Enter' && event.preventDefault()}
					/>
				</div>
				<p><span>Type:</span> {commandUserString(this.props.command)}</p>
				<a className={'Confirm Button'} href="#" onClick={this.props.onConfirmClick}>Confirm</a>
			</div>
		);
	}

}

class AppComponent extends Component {

	constructor() {
		super();

		this.state = ({
			contentScriptLoaded: false,
			selectedTags: [],
			favouriteSets: [],
			newFavouriteId: null,
			focusableActionIndex: 0,
			contentScriptError: '',
			newNoteId: null,
		});

		this.confirm_click = async () => {
			const content = { ...this.props.clippedContent };
			content.tags = this.state.selectedTags.join(',');
			content.parent_id = this.props.selectedFolderId;
			const response = await bridge().sendContentToJoplin(content);
			this.setState({ newNoteId: response.id });
		};

		this.contentTitle_change = (event) => {
			this.props.dispatch({
				type: 'CLIPPED_CONTENT_TITLE_SET',
				// A note title is a single line, so pasted line breaks become spaces.
				text: event.currentTarget.value.replace(/[\r\n]+/g, ' '),
			});
		};

		this.clipSimplified_click = () => {
			bridge().sendCommandToActiveTab({
				name: 'simplifiedPageHtml',
			});
		};

		this.clipComplete_click = () => {
			bridge().sendCommandToActiveTab({
				name: 'completePageHtml',
				preProcessFor: 'markdown',
			});
		};

		this.clipCompleteHtml_click = () => {
			bridge().sendCommandToActiveTab({
				name: 'completePageHtml',
				preProcessFor: 'html',
			});
		};

		this.clipSelection_click = () => {
			bridge().sendCommandToActiveTab({
				name: 'selectedHtml',
			});
		};

		this.clipUrl_click = () => {
			bridge().sendCommandToActiveTab({
				name: 'pageUrl',
			});
		};

		this.clipScreenshot_click = async () => {
			try {
				// Firefox requires the <all_urls> host permission to take a
				// screenshot of the current page, however, this may change
				// in the future. Note that Firefox also forces this permission
				// to be optional.
				// See https://discourse.mozilla.org/t/browser-tabs-capturevisibletab-not-working-in-firefox-for-mv3/122965/3
				await bridge().browser().permissions.request({ origins: ['<all_urls>'] });

				const baseUrl = await bridge().clipperServerBaseUrl();

				await bridge().sendCommandToActiveTab({
					name: 'screenshot',
					api_base_url: baseUrl,
					parent_id: this.props.selectedFolderId,
					tags: this.state.selectedTags.join(','),
					token: bridge().token(),
				});

				window.close();
			} catch (error) {
				this.props.dispatch({ type: 'CONTENT_UPLOAD', operation: { uploading: false, success: false, errorMessage: error.message } });
			}
		};

		this.clipperServerHelpLink_click = () => {
			bridge().tabsCreate({ url: 'https://joplinapp.org/help/apps/clipper' });
		};

		this.settingsLink_click = (event) => {
			event.preventDefault();
			bridge().browser().runtime.openOptionsPage();
		};

		this.folderSelect_change = (event) => {
			this.props.dispatch({
				type: 'SELECTED_FOLDER_SET',
				id: event.target.value,
			});
		};

		this.selectedTags_change = (selectedTags) => {
			this.setState({ selectedTags });
			bridge().storageSet({ selectedTags });
		};

		this.favouriteSets_change = (favouriteSets, extraState = {}) => {
			this.setState({ favouriteSets, ...extraState });
			bridge().storageSet({ favouriteSets });
		};

		this.favouriteSets_save = () => {
			const tags = this.state.selectedTags;
			if (!tags.length || this.isFavouriteSelection()) return;

			const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
			this.favouriteSets_change([...this.state.favouriteSets, { id, name: '', tags, folderId: this.props.selectedFolderId || null }], { newFavouriteId: id });
		};

		this.favouriteSets_setFolder = (id, folderId) => {
			this.favouriteSets_change(this.state.favouriteSets.map(item => (item.id === id ? { ...item, folderId } : item)));
		};

		this.favouriteSets_rename = (id, name) => {
			this.favouriteSets_change(this.state.favouriteSets.map(item => (item.id === id ? { ...item, name } : item)));
		};

		this.favouriteSets_delete = (id) => {
			this.favouriteSets_change(this.state.favouriteSets.filter(item => item.id !== id));
		};

		this.favouriteSets_apply = (favouriteSet) => {
			const merged = [...this.state.selectedTags];
			for (const tag of favouriteSet.tags) {
				if (!merged.some(existing => isSameTag(existing, tag))) merged.push(tag);
			}
			this.selectedTags_change(merged.sort(compareTags));

			// A notebook that no longer exists is ignored and the current one stays.
			if (favouriteSet.folderId && this.findFolder(favouriteSet.folderId)) {
				this.props.dispatch({ type: 'SELECTED_FOLDER_SET', id: favouriteSet.folderId });
			}
		};

		// Only one action button is in the tab order, the arrow keys move between them.
		this.actions_keyDown = (event) => {
			const buttons = Array.from(event.currentTarget.querySelectorAll('a.Button'));
			const index = buttons.indexOf(document.activeElement);
			if (index < 0) return;

			if (event.key === ' ') {
				event.preventDefault();
				buttons[index].click();
				return;
			}

			const targets = {
				ArrowDown: Math.min(index + 1, buttons.length - 1),
				ArrowUp: Math.max(index - 1, 0),
				Home: 0,
				End: buttons.length - 1,
			};
			if (!(event.key in targets)) return;

			event.preventDefault();
			buttons[targets[event.key]].focus();
		};

		this.actions_focus = (event) => {
			const buttons = Array.from(event.currentTarget.querySelectorAll('a.Button'));
			const index = buttons.indexOf(event.target);
			if (index >= 0 && index !== this.state.focusableActionIndex) this.setState({ focusableActionIndex: index });
		};
	}

	async loadContentScripts() {
		await bridge().tabsExecuteScript([
			'/content_scripts/setUpEnvironment.js',
			'/content_scripts/JSDOMParser.js',
			'/content_scripts/Readability.js',
			'/content_scripts/Readability-readerable.js',
			'/content_scripts/clipperUtils.js',
			'/content_scripts/youtubeTranscript.js',
			'/content_scripts/index.js',
		]);
	}

	async restoreSelectedTags() {
		const stored = await bridge().storageGet(['selectedTags']);
		if (!stored || !Array.isArray(stored.selectedTags)) return;

		const selectedTags = stored.selectedTags.filter(tag => typeof tag === 'string');
		// Tags the user already changed while this was loading win.
		this.setState(state => (state.selectedTags.length ? null : { selectedTags }));
	}

	findFolder(id, folders = this.props.folders) {
		for (const folder of folders) {
			if (folder.id === id) return folder;
			const found = folder.children && this.findFolder(id, folder.children);
			if (found) return found;
		}
		return null;
	}

	flatFolders(folders = this.props.folders, depth = 0) {
		return folders.flatMap(folder => [
			{ id: folder.id, title: folder.title, depth },
			...(folder.children ? this.flatFolders(folder.children, depth + 1) : []),
		]);
	}

	isFavouriteSelection() {
		const { selectedTags, favouriteSets } = this.state;
		const folderId = this.props.selectedFolderId || null;
		return favouriteSets.some(item => item.folderId === folderId && item.tags.length === selectedTags.length && item.tags.every(tag => selectedTags.some(selected => isSameTag(selected, tag))));
	}

	async restoreFavouriteSets() {
		const stored = await bridge().storageGet(['favouriteSets', 'favouriteTags']);
		if (!stored) return;

		if (Array.isArray(stored.favouriteSets)) {
			const favouriteSets = stored.favouriteSets
				.filter(item => item && typeof item.id === 'string' && Array.isArray(item.tags))
				.map(item => ({
					id: item.id,
					name: typeof item.name === 'string' ? item.name : '',
					tags: item.tags.filter(tag => typeof tag === 'string'),
					folderId: typeof item.folderId === 'string' ? item.folderId : null,
				}))
				.filter(item => item.tags.length);
			this.setState({ favouriteSets });
			return;
		}

		// Before named sets existed, one unnamed set of tags was stored.
		if (Array.isArray(stored.favouriteTags)) {
			const tags = stored.favouriteTags.filter(tag => typeof tag === 'string');
			if (tags.length) this.favouriteSets_change([{ id: 'legacy', name: '', tags, folderId: null }]);
		}
	}

	async componentDidMount() {
		bridge().onReactAppStarts();
		void this.restoreSelectedTags();
		void this.restoreFavouriteSets();

		try {
			await this.loadContentScripts();
		} catch (error) {
			console.error('Could not load content scripts', error);
			this.setState({ contentScriptError: error.message });
			return;
		}

		this.setState({
			contentScriptLoaded: true,
		});

		let foundSelectedFolderId = false;

		const searchSelectedFolder = (folders) => {
			for (let i = 0; i < folders.length; i++) {
				const folder = folders[i];
				if (folder.id === this.props.selectedFolderId) foundSelectedFolderId = true;
				if (folder.children) searchSelectedFolder(folder.children);
			}
		};

		searchSelectedFolder(this.props.folders);

		if (!foundSelectedFolderId) {
			const newFolderId = this.props.folders.length ? this.props.folders[0].id : null;
			this.props.dispatch({
				type: 'SELECTED_FOLDER_SET',
				id: newFolderId,
			});
		}

		bridge().sendCommandToActiveTab({ name: 'isProbablyReaderable' });
	}

	componentDidUpdate() {
		if (this.focusNewTagInput_) {
			this.focusNewTagInput_ = false;
			let lastRef = null;
			for (let i = 0; i < 100; i++) {
				const ref = this.refs[`tagSelector${i}`];
				if (!ref) break;
				lastRef = ref;
			}
			// eslint-disable-next-line no-restricted-properties
			if (lastRef) lastRef.focus();
		}
	}

	renderStartupScreen() {
		const messages = {
			serverFoundState: {
				// We need to display the "Connecting to the Joplin
				// application..." message because if the app doesn't currently
				// allow access to the clipper API, the clipper tries several
				// ports and it takes time before failing. So if we don't
				// display any message, it looks like it's not doing anything
				// when clicking on the extension button.
				'searching': 'Connecting to the Joplin application...',
				'not_found': 'Error: Could not connect to the Joplin application. Please ensure that it is started and that the clipper service is enabled in the configuration.',
			},
			authState: {
				'starting': 'Starting...',
				'waiting': 'The Joplin Web Clipper requires your authorisation in order to access your data. To proceed, please open the Joplin desktop application and grant permission. Note: Joplin 2.1+ is needed to use this version of the Web Clipper.',
				'rejected': 'Permission to access your data was not granted. To try again please close this popup and open it again.',
			},
		};

		const foundState = this.props.clipperServer.foundState;

		let msg = '';
		let title = '';

		if (messages.serverFoundState[foundState]) {
			msg = messages.serverFoundState[foundState];
		} else {
			msg = messages.authState[this.props.authStatus];
			title = <h1>{'Permission needed'}</h1>;
		}

		if (!msg) throw new Error(`Invalidate state: ${foundState} / ${this.props.authStatus}`);

		return (
			<div className="App Startup">
				{title}
				{msg}
			</div>
		);
	}

	render() {
		if (this.props.authStatus !== 'accepted') {
			return this.renderStartupScreen();
		}

		if (!this.state.contentScriptLoaded) {
			let msg = 'Loading...';
			if (this.state.contentScriptError) msg = `The Joplin extension is not available on this tab due to: ${this.state.contentScriptError}`;
			return (
				<div className="App Startup">
					{msg}
				</div>
			);
		}

		const warningComponent = !this.props.warning ? null : <div className="Warning">{ this.props.warning }</div>;

		const hasContent = !!this.props.clippedContent;
		const content = this.props.clippedContent;

		let previewComponent = null;

		const operation = this.props.contentUploadOperation;

		if (operation) {
			let msg = '';

			if (operation.searchingClipperServer) {
				msg = 'Searching clipper service... Please make sure that Joplin is running.';
			} else if (operation.uploading) {
				msg = 'Processing note... The note will be available in Joplin as soon as the web page and images have been downloaded and converted. In the meantime you may close this popup.';
			} else if (operation.success) {
				msg = 'Note was successfully created!';
			} else {
				msg = `There was some error creating the note: ${operation.errorMessage}`;
			}

			previewComponent = (
				<div className="Preview">
					<p className="Info">{ msg }</p>
				</div>
			);
		} else if (hasContent) {
			previewComponent = <PreviewComponent
				onConfirmClick={this.confirm_click}
				title={content.title}
				body_html={content.body_html}
				onTitleChange={this.contentTitle_change}
				command={content.source_command}
			/>;
		}

		const clipperStatusComp = () => {

			const stateToString = function(state) {
				if (state === 'not_found') return 'Not found';
				return state.charAt(0).toUpperCase() + state.slice(1);
			};

			let msg = '';
			let led = null;
			let helpLink = null;

			const foundState = this.props.clipperServer.foundState;

			if (foundState === 'found') {
				msg = `Ready on port ${this.props.clipperServer.port}`;
				led = led_green;
			} else {
				msg = stateToString(foundState);
				led = foundState === 'searching' ? led_orange : led_red;
				if (foundState === 'not_found') helpLink = <a className="Help" onClick={this.clipperServerHelpLink_click} href="help">[Help]</a>;
			}

			msg = `Service status: ${msg}`;

			return <div className="StatusBar"><img alt={foundState} className="Led" src={led}/><span className="ServerStatus">{ msg }{ helpLink }</span><a className="SettingsLink" onClick={this.settingsLink_click} href="#">Settings</a></div>;
		};

		const foldersComp = () => {
			const optionComps = [];

			const nonBreakingSpacify = (s) => {
				// https://stackoverflow.com/a/24437562/561309
				return s.replace(/ /g, '\u00a0');
			};

			const addOptions = (folders, depth) => {
				for (let i = 0; i < folders.length; i++) {
					const folder = folders[i];
					optionComps.push(<option key={folder.id} value={folder.id}>{nonBreakingSpacify('    '.repeat(depth) + folder.title)}</option>);
					if (folder.children) addOptions(folder.children, depth + 1);
				}
			};

			addOptions(this.props.folders, 0);

			return (
				<div className="Folders">
					<label>Notebook</label>
					<select value={this.props.selectedFolderId || ''} onChange={this.folderSelect_change}>
						{ optionComps }
					</select>
				</div>
			);
		};

		const openNewNoteButton = () => {

			if (!this.state.newNoteId) { return null; } else {
				return (
					// The jopin:// link must be opened in a new tab. When it's opened for the first time, a system dialog will ask for the user's permission.
					// The system dialog is too big to fit into the popup so the user will not be able to see the dialog buttons and get stuck.
					<a
						className="Button"
						href={`joplin://x-callback-url/openNote?id=${encodeURIComponent(this.state.newNoteId)}`}
						target="_blank"
						onClick={() => this.setState({ newNoteId: null })}
					>
          Open newly created note
					</a>
				);
			}
		};

		let simplifiedPageButtonLabel = 'Clip simplified page';
		let simplifiedPageButtonTooltip = '';
		if (!this.props.isProbablyReaderable) {
			simplifiedPageButtonLabel += ' ⚠️';
			simplifiedPageButtonTooltip = 'It might not be possible to create a good simplified version of this page.\nYou may want to clip the complete page instead.';
		}

		const actionButtons = [
			{ label: simplifiedPageButtonLabel, tooltip: simplifiedPageButtonTooltip, onClick: this.clipSimplified_click },
			{ label: 'Clip complete page (Markdown)', onClick: this.clipComplete_click },
			{ label: 'Clip complete page (HTML)', onClick: this.clipCompleteHtml_click },
			{ label: 'Clip selection', onClick: this.clipSelection_click },
			{ label: 'Clip screenshot', onClick: this.clipScreenshot_click },
			{ label: 'Clip URL', onClick: this.clipUrl_click },
		];

		return (
			<div className="App">
				<fieldset className="Group">
					<legend>Storage Location</legend>
					{ foldersComp() }
					<TagInput
						allTags={this.props.tags.map(tag => tag.title)}
						selectedTags={this.state.selectedTags}
						onChange={this.selectedTags_change}
						isFavourite={this.isFavouriteSelection()}
						onSaveFavourites={this.favouriteSets_save}
					/>
					<FavouriteSets
						sets={this.state.favouriteSets}
						newSetId={this.state.newFavouriteId}
						onNewSetHandled={() => this.setState({ newFavouriteId: null })}
						onApply={this.favouriteSets_apply}
						folderTitle={id => this.findFolder(id)?.title}
						onRename={this.favouriteSets_rename}
						folderOptions={this.flatFolders()}
						onChangeFolder={this.favouriteSets_setFolder}
						onDelete={this.favouriteSets_delete}
					/>
				</fieldset>
				<fieldset className="Group">
					<legend>Action</legend>
					<div className="Controls">
						<ul role="toolbar" aria-orientation="vertical" aria-label="Action" onKeyDown={this.actions_keyDown} onFocus={this.actions_focus}>
							{ actionButtons.map((button, index) => (
								<li key={button.label} role="none">
									<a
										className="Button"
										role="button"
										href="#"
										tabIndex={index === this.state.focusableActionIndex ? 0 : -1}
										onClick={button.onClick}
										title={button.tooltip}
									>
										{button.label}
									</a>
								</li>
							)) }
						</ul>
					</div>
				</fieldset>
				{ warningComponent }
				{ previewComponent }
				{ openNewNoteButton() }
				{ clipperStatusComp() }
			</div>
		);
	}

}

const mapStateToProps = (state) => {
	return {
		warning: state.warning,
		clippedContent: state.clippedContent,
		contentUploadOperation: state.contentUploadOperation,
		clipperServer: state.clipperServer,
		folders: state.folders,
		tags: state.tags,
		selectedFolderId: state.selectedFolderId,
		isProbablyReaderable: state.isProbablyReaderable,
		authStatus: state.authStatus,
	};
};

const App = connect(mapStateToProps)(AppComponent);

export default App;
