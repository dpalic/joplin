import React, { useEffect, useId, useRef, useState } from 'react';
import { compareTags } from './TagInput';

// A set without a name is shown by its tags.
const setLabel = favouriteSet => favouriteSet.name || favouriteSet.tags.join(', ');

const FavouriteSets = ({ sets, newSetId, onNewSetHandled, folderTitle, folderOptions, onApply, onRename, onChangeFolder, onDelete }) => {
	const id = useId();
	const inputRef = useRef(null);
	const editingIdRef = useRef(null);
	const [query, setQuery] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [editingId, setEditingId] = useState(null);
	const [editName, setEditName] = useState('');

	const notebookLabel = favouriteSet => (favouriteSet.folderId ? folderTitle(favouriteSet.folderId) || 'Unknown notebook' : '');

	const needle = query.trim().toLowerCase();
	const options = sets
		.filter(favouriteSet => !needle || [setLabel(favouriteSet), notebookLabel(favouriteSet), ...favouriteSet.tags].some(text => text.toLowerCase().includes(needle)))
		.sort((a, b) => compareTags(setLabel(a), setLabel(b)));
	const currentIndex = Math.min(activeIndex, options.length - 1);
	const activeSet = options[currentIndex];

	const startEdit = (favouriteSet) => {
		editingIdRef.current = favouriteSet.id;
		setEditingId(favouriteSet.id);
		setEditName(favouriteSet.name);
	};

	const stopEdit = () => {
		editingIdRef.current = null;
		setEditingId(null);
		inputRef.current?.focus();
	};

	const commitEdit = (setId) => {
		if (editingIdRef.current !== setId) return;
		onRename(setId, editName.trim());
		stopEdit();
	};

	useEffect(() => {
		if (!newSetId) return;
		const favouriteSet = sets.find(item => item.id === newSetId);
		if (favouriteSet) {
			setQuery('');
			setIsOpen(true);
			startEdit(favouriteSet);
		}
		onNewSetHandled();
	}, [newSetId]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!isOpen || !activeSet) return;
		document.getElementById(`${id}-option-${activeSet.id}`)?.scrollIntoView({ block: 'nearest' });
	}, [isOpen, activeSet, id]);

	const applySet = (favouriteSet) => {
		onApply(favouriteSet);
		setQuery('');
		setActiveIndex(0);
		setIsOpen(false);
	};

	const input_keyDown = (event) => {
		switch (event.key) {
		case 'ArrowDown':
			event.preventDefault();
			if (isOpen) setActiveIndex(Math.min(currentIndex + 1, options.length - 1));
			else setIsOpen(true);
			break;
		case 'ArrowUp':
			event.preventDefault();
			if (isOpen) setActiveIndex(Math.max(currentIndex - 1, 0));
			break;
		case 'Enter':
			if (isOpen && activeSet) {
				event.preventDefault();
				applySet(activeSet);
			}
			break;
		case 'F2':
			if (isOpen && activeSet) {
				event.preventDefault();
				startEdit(activeSet);
			}
			break;
		case 'Delete':
			if (event.shiftKey && isOpen && activeSet) {
				event.preventDefault();
				onDelete(activeSet.id);
			}
			break;
		case 'Escape':
			if (isOpen) {
				event.preventDefault();
				setIsOpen(false);
			}
			break;
		}
	};

	const editInput_keyDown = (event, setId) => {
		// The keys must not reach the search field.
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			commitEdit(setId);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			stopEdit();
		}
	};

	// Moving between the name field and the notebook select keeps the edit open.
	const editField_blur = (event, setId) => {
		if (event.relatedTarget && event.currentTarget.parentElement.contains(event.relatedTarget)) return;
		commitEdit(setId);
	};

	const wrapper_blur = (event) => {
		if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
	};

	const option_click = (event, favouriteSet) => {
		if (event.target.closest('button, input, select')) return;
		applySet(favouriteSet);
	};

	// Keeps the focus where it is, otherwise the blur would close the list before the click.
	const option_mouseDown = (event) => {
		if (!['INPUT', 'SELECT', 'OPTION'].includes(event.target.tagName)) event.preventDefault();
	};

	const showList = isOpen && sets.length > 0;

	return (
		<div className="Favourites">
			<label htmlFor={`${id}-input`}>Favourites</label>
			<div className="FavouritesCombo" onBlur={wrapper_blur}>
				<input
					id={`${id}-input`}
					ref={inputRef}
					type="text"
					role="combobox"
					autoComplete="off"
					aria-autocomplete="list"
					aria-expanded={showList && options.length > 0}
					aria-controls={`${id}-list`}
					aria-activedescendant={showList && activeSet ? `${id}-option-${activeSet.id}` : undefined}
					placeholder={sets.length ? 'Search favourites' : 'No favourites saved'}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActiveIndex(0);
						setIsOpen(true);
					}}
					onKeyDown={input_keyDown}
					onFocus={() => setIsOpen(true)}
					onClick={() => setIsOpen(true)}
				/>
				{showList && (
					<ul className="FavouritesOptions" id={`${id}-list`} role="listbox" aria-label="Favourite tag sets">
						{options.length === 0 && <li className="Empty" role="presentation">No match</li>}
						{options.map((favouriteSet, index) => {
							const isEditing = favouriteSet.id === editingId;
							const label = setLabel(favouriteSet);
							const notebook = notebookLabel(favouriteSet);
							const details = [notebook, favouriteSet.name ? favouriteSet.tags.join(', ') : ''].filter(Boolean).join(' · ');
							return (
								<li
									key={favouriteSet.id}
									id={`${id}-option-${favouriteSet.id}`}
									role="option"
									aria-selected={index === currentIndex}
									className={index === currentIndex ? 'Active' : ''}
									onMouseDown={option_mouseDown}
									onMouseMove={() => setActiveIndex(index)}
									onClick={event => option_click(event, favouriteSet)}
								>
									{isEditing ? (
										<span className="FavouriteEdit">
											<input
												className="FavouriteNameInput"
												type="text"
												autoFocus
												placeholder="Name (optional)"
												aria-label="Favourite name"
												value={editName}
												onChange={event => setEditName(event.target.value)}
												onKeyDown={event => editInput_keyDown(event, favouriteSet.id)}
												onBlur={event => editField_blur(event, favouriteSet.id)}
											/>
											<select
												className="FavouriteNotebook"
												aria-label="Favourite notebook"
												value={favouriteSet.folderId || ''}
												onChange={event => onChangeFolder(favouriteSet.id, event.target.value || null)}
												onKeyDown={event => editInput_keyDown(event, favouriteSet.id)}
												onBlur={event => editField_blur(event, favouriteSet.id)}
											>
												<option value="">No notebook</option>
												{favouriteSet.folderId && !folderTitle(favouriteSet.folderId) && <option value={favouriteSet.folderId}>Unknown notebook</option>}
												{folderOptions.map(folder => (
													<option key={folder.id} value={folder.id}>{'    '.repeat(folder.depth) + folder.title}</option>
												))}
											</select>
										</span>
									) : (
										<span className="FavouriteText">
											<span className={favouriteSet.name ? 'FavouriteName' : 'FavouriteName Unnamed'}>{label}</span>
											{details && <span className="FavouriteTags">{details}</span>}
										</span>
									)}
									{!isEditing && (
										<span className="FavouriteActions">
											<button type="button" tabIndex={-1} title="Rename (F2)" aria-label={`Rename ${label}`} onClick={() => startEdit(favouriteSet)}>
												<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
													<path fill="currentColor" d="M11.8 1.6l2.6 2.6-8.5 8.5-3.4.8.8-3.4 8.5-8.5z"/>
												</svg>
											</button>
											<button type="button" tabIndex={-1} title="Delete (Shift+Delete)" aria-label={`Delete ${label}`} onClick={() => onDelete(favouriteSet.id)}>×</button>
										</span>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
};

export default FavouriteSets;
