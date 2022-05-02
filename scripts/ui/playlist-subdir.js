import SidebarDirectory from "./sidebar-dir.js"
import LocalSound from "../local-controls/local-sound.js"
import Settings from "../settings.js"
import Globals from "../globals.js"
import {remoteAction} from "../network/util.js"

class PlaylistDirectory extends SidebarDirectory {
  constructor(options) {
    super(options);

    /**
     * Track the playlist IDs which are currently expanded in their display
     * @type {Set<string>}
     */
    this._expanded = this._createExpandedSet();

    /**
     * Are the global volume controls currently expanded?
     * @type {boolean}
     * @private
     */
    this._volumeExpanded = false;

    /**
     * Cache the set of Playlist documents that are displayed as playing when the directory is rendered
     * @type {Playlist[]}
     */
    this._playingPlaylists = [];

    /**
     * Cache the set of PlaylistSound documents that are displayed as playing when the directory is rendered
     * @type {PlaylistSound[]}
     */
    this._playingSounds = [];

    // Update timestamps every second
    setInterval(this._updateTimestamps.bind(this), 1000);

    // Playlist 'currently playing' pinned location.
    game.settings.register("core", "playlist.playingLocation", {
      scope: "client",
      config: false,
      default: "top",
      type: String,
      onChange: () => ui.playlists.render()
    });
  }

  /** @override */
  static documentName = "Playlist";

  /** @override */
  static documentPartial = "templates/sidebar/playlist-partial.html";

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.template = "templates/sidebar/playlists-directory.html";
    options.dragDrop[0].dragSelector = ".playlist-name, .sound-name";
    options.renderUpdateKeys = ["name", "playing", "mode", "sounds", "sort", "sorting", "folder"];
    options.contextMenuSelector = ".document .playlist-header";
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Initialize the set of Playlists which should be displayed in an expanded form
   * @returns {Set<string>}
   * @private
   */
  _createExpandedSet() {
    const expanded = new Set();
    for ( let playlist of this.documents ) {
      if ( playlist.playing ) expanded.add(playlist.id);
    }
    return expanded;
  }

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * Return an Array of the Playlist documents which are currently playing
   * @type {Playlist[]}
   */
  get playing() {
    return this._playingPlaylists;
  }

  /**
   * Whether the 'currently playing' element is pinned to the top or bottom of the display.
   * @type {string}
   * @private
   */
  get _playingLocation() {
    return game.settings.get("core", "playlist.playingLocation");
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    this._playingPlaylists = [];
    this._playingSounds = [];
    this._playingSoundsData = [];
    this._prepareTreeData(this.tree);
    const data = await super.getData(options);
    const currentAtTop = this._playingLocation === "top";
    return foundry.utils.mergeObject(data, {
      playingSounds: this._playingSoundsData,
      showPlaying: this._playingSoundsData.length > 0,
      playlistModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalPlaylistVolume")),
      ambientModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalAmbientVolume")),
      interfaceModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalInterfaceVolume")),
      volumeExpanded: this._volumeExpanded,
      currentlyPlaying: {
        class: `location-${currentAtTop ? "top" : "bottom"}`,
        location: {top: currentAtTop, bottom: !currentAtTop},
        pin: {label: `PLAYLIST.PinTo${currentAtTop ? "Bottom" : "Top"}`, caret: currentAtTop ? "down" : "up"}
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Augment the tree directory structure with playlist-level data objects for rendering
   * @param {object} leaf   The tree leaf node being prepared
   * @private
   */
  _prepareTreeData(leaf) {
    leaf.content = leaf.content.map(p => this._preparePlaylistData(p));
    for ( let f of leaf.children ) {
      this._prepareTreeData(f);
    }
  }

  /* -------------------------------------------- */

  /**
   * Create an object of rendering data for each Playlist document being displayed
   * @param {Playlist} playlist   The playlist to display
   * @returns {object}            The data for rendering
   * @private
   */
  _preparePlaylistData(playlist) {
    if ( playlist.playing ) this._playingPlaylists.push(playlist);
	
    // Playlist configuration
    const p = playlist.data.toObject(false);
    p.modeTooltip = this._getModeTooltip(p.mode);
    p.modeIcon = this._getModeIcon(p.mode);
    p.disabled = p.mode === CONST.PLAYLIST_MODES.DISABLED;
    p.expanded = this._expanded.has(p._id);
    p.css = [p.expanded ? "" : "collapsed", playlist.playing ? "playing" : ""].filterJoin(" ")
    p.controlCSS = (Settings.can_control(game.userId, playlist) && !p.disabled) ? "" : "disabled";

    // Playlist sounds
    const sounds = [];
    for ( let sound of playlist.sounds ) {
      if ( !Settings.can_view(sound) && !sound.playing && (!sound.data.pausedTime && Settings.can_control(game.userId, playlist)) ){
		continue;
	  }

      // All sounds
      const s = sound.data.toObject(false);
      s.playlistId = playlist.id;
      s.css = s.playing ? "playing" : "";
      s.controlCSS = Settings.can_control(game.userId, playlist) ? "" : "disabled";
      s.playIcon = this._getPlayIcon(sound);
      s.playTitle = s.pausedTime ? "PLAYLIST.SoundResume" : "PLAYLIST.SoundPlay";

      // Playing sounds
      if ( sound.sound && !sound.sound.failed && (sound.playing || s.pausedTime) ) {
        s.isPaused = !sound.playing && s.pausedTime;
        s.pauseIcon = this._getPauseIcon(sound);
        s.lvolume = AudioHelper.volumeToInput(s.volume);
        s.currentTime = this._formatTimestamp(sound.playing ? sound.sound.currentTime : s.pausedTime);
        s.durationTime = this._formatTimestamp(sound.sound.duration);
        this._playingSounds.push(sound);
        this._playingSoundsData.push(s);
      }
      sounds.push(s);
    }
    p.sounds = sounds;
    return p;
  }

  /* -------------------------------------------- */

  /**
   * Get the icon used to represent the "play/stop" icon for the PlaylistSound
   * @param {PlaylistSound} sound   The sound being rendered
   * @returns {string}              The icon that should be used
   * @private
   */
  _getPlayIcon(sound) {
    if ( !sound.playing ) return sound.data.pausedTime ? "fas fa-play-circle" : "fas fa-play";
    else return "fas fa-square";
  }

  /* -------------------------------------------- */

  /**
   * Get the icon used to represent the pause/loading icon for the PlaylistSound
   * @param {PlaylistSound} sound   The sound being rendered
   * @returns {string}              The icon that should be used
   * @private
   */
  _getPauseIcon(sound) {
    return (sound.playing && !sound.sound?.loaded) ? "fas fa-spinner fa-spin" : "fas fa-pause";
  }

  /* -------------------------------------------- */

  /**
   * Given a constant playback mode, provide the FontAwesome icon used to display it
   * @param {number} mode
   * @return {string}
   * @private
   */
  _getModeIcon(mode) {
    return {
      [CONST.PLAYLIST_MODES.DISABLED]: '<i class="fas fa-ban"></i>',
      [CONST.PLAYLIST_MODES.SEQUENTIAL]: '<i class="far fa-arrow-alt-circle-right"></i>',
      [CONST.PLAYLIST_MODES.SHUFFLE]: '<i class="fas fa-random"></i>',
      [CONST.PLAYLIST_MODES.SIMULTANEOUS]: '<i class="fas fa-compress-arrows-alt"></i>',
    }[mode];
  }

  /* -------------------------------------------- */

  /**
   * Given a constant playback mode, provide the string tooltip used to describe it
   * @param {number} mode
   * @return {string}
   * @private
   */
  _getModeTooltip(mode) {
    return {
      [CONST.PLAYLIST_MODES.DISABLED]: game.i18n.localize("PLAYLIST.ModeDisabled"),
      [CONST.PLAYLIST_MODES.SEQUENTIAL]: game.i18n.localize("PLAYLIST.ModeSequential"),
      [CONST.PLAYLIST_MODES.SHUFFLE]: game.i18n.localize("PLAYLIST.ModeShuffle"),
      [CONST.PLAYLIST_MODES.SIMULTANEOUS]: game.i18n.localize("PLAYLIST.ModeSimultaneous")
    }[mode];
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */
  
	_onSelectedGroupChange(event){
		console.log("Selected new group in dropdown!")
	}
  
	_onNewGroup(event){
		let dialog_content = `<div>Name: <input type="text" name="groupName"></div><hr/>`
		dialog_content +=`<form><div class="form-group"><label>Users: </label><select multiple name="users" id="users">`
		game.users.forEach(function(user){
		  dialog_content+="\n<option value=" + user.id + ">"+ (user.isGM ? user.name : user.character.name) +"</option>"
		});
		dialog_content+=`</select></div><div>(Control-click to select multiple)</div></form>`
		
		let applyChanges = false;
		new Dialog({
			title: `New Local Sound Control Group`,
			content: dialog_content,
			buttons: {
				yes: {
					icon: "<i class='fas fa-check'></i>",
					label: `Confirm`,
					callback: () => applyChanges = true
				},
				no: {
					icon: "<i class='fas fa-times'></i>",
					label: `Cancel`,
					callback: () => applyChanges = false
				},
			},
			default: "yes",
			close: (html) => {
				if (applyChanges) {
					let groupName = html.find('[name="groupName"]')[0].value
					console.log(groupName)
					
					let userIds = [];
					for(let opt of html.find(`[name="users"]`)[0].selectedOptions){
						userIds.push(opt.value)
					}
					if(userIds.length < 1) {
						ui.notifications.error("Cannot create a group with no users.")
						return;
					}
					
					if(!groupName || groupName == ""){
						ui.notifications.error("You must choose a name for the group.");
						return;
					}
					if(groupName == "Global"){
						ui.notifications.error("Group \"Global\" already exists.");
						return;
					}
					let matchingGroup = Settings.local_groups().find(group => {
						return group.name == groupName
					});
					if(matchingGroup){
						ui.notifications.error("Group \"" + groupName + "\" already exists.");
						return;
					}
					matchingGroup = game.users.find(user => {
						return groupName == (user.isGM ? user.name : user.character.name);
					});
					if(matchingGroup){
						ui.notifications.error("Group \"" + groupName + "\" already exists.");
						return;
					}
					
					//Validated all inputs! Woooo. Add the group.
					let local_groups = Settings.local_groups();
					local_groups.push({name: groupName, userIds: userIds});
					Settings.local_groups(local_groups);
					
					this.render(true);
					console.log(this);
					
					return true; //Allow to close
				}
			}
		}, {jQuery: true}).render(true)
		
	}

	_onDeleteGroup(event){
		let btn = event.currentTarget;
		let sel = btn.parentNode.lastChild.firstChild.firstChild.firstChild;
		
		let groupName = sel.options[sel.selectedIndex].text;
		
		let idx = Settings.local_groups().findIndex( group => {
			return group.name == groupName;
		});
		
		if(idx == -1){
			ui.notifications.error("You can only delete created groups.");
		} else {
			
			Dialog.confirm({
				title: "Delete local sound group \"" + groupName + "\"?",
				content: "<p>This is permanent.<p>",
				yes: () =>{
					let localGroups = Settings.local_groups()
					localGroups.splice(idx, 1)
					Settings.local_groups(localGroups);
				},
				no: () => {},
				defaultYes: true
			})
		}
	}

  /** @override */
  activateListeners(html) {
    if(!game.user.isGM){ //Already there for GMs
	  if(Settings.can_control()){
		  html.find('.sound-controls').each(function(num, div){
			if(div.className.includes("playlist-controls")) return;
			const li = div.closest(".sound")
			const playlist = game.playlists.get(li.dataset.playlistId);
			const sound = playlist.sounds.get(li.dataset.soundId);
			
			div.innerHTML = `
					<a class="sound-control ` + (sound.data?.repeat ? " " : " inactive ") + ((playlist.permission > 2) ? "" : "disabled") + `"
						data-action="sound-repeat" title="` + game.i18n.localize('PLAYLIST.SoundLoop') + `">
						<i class="fas fa-sync"></i>
					</a>` + div.innerHTML;
		  });
	  }
	  
	  if(Settings.can_edit() || Settings.can_control() || !Settings.limited_vision()){
		  html.find('.playlist-controls').each(function(num, div){
			 const li = div.closest(".playlist-header")
			 const playlist = game.playlists.get(li.dataset.documentId);
			 
			 if(playlist.permission == 1 && !Settings.limited_vision()){
				li.querySelector(".playlist-name").querySelector(".collapse").style.display = 'none'
				div.querySelectorAll(".sound-control").forEach( function(idiv){
					if(["Previous Sound", "Next Sound"].includes(idiv.title)) idiv.style.display = "none"
				});
			 }
			 
			 if(Settings.can_control(game.userId, playlist)){
				div.innerHTML = div.innerHTML.replaceAll("disabled", "")
				if(playlist.mode == CONST.PLAYLIST_MODES.DISABLED){
					div.querySelectorAll(".sound-control").forEach( function(idiv){
						if(idiv.attributes["data-action"].nodeValue == "playlist-play"){
							idiv.disabled = true
						}
					});
				}
			 }
			 
			 
			 if(!div.innerHTML.includes("playlist-stop") && Settings.can_edit(game.userId, playlist)){
				div.innerHTML = `
				<a class="sound-control" data-action="sound-create" title="` + game.i18n.localize('PLAYLIST.SoundCreate') + `">
					<i class="fas fa-plus"></i>
				</a>` + div.innerHTML;
			 }
		  });
	  }
	  
	  if(Settings.can_create()){
		  html.find('.folder-header').each(function(num, div){
			  const li = div.closest(".directory-item")
			  if(!li) return;
			  let folderId = li.dataset.folderId;
			  
			  div.innerHTML += `<a class="create-folder" data-parent-folder="` + folderId + 
			                   `"><i class="fas fa-folder-plus fa-fw"></i></a>
                                <a class="create-document" data-folder="` + folderId + 
							   `"><i class="fas fa-user-plus fa-fw"></i></a>`
		  });
	  }
	}
	
	if(Settings.can_local_control()){
		html.find(".directory-header").each((num, div) => {
			
			let newDiv= "<div class=\"form-group\">"
			
			//New group button
			newDiv += "<button><span><i class=\"fas fa-plus\"></i></span></button>"
			
			//Delete group button
			newDiv += "<button><span><i class=\"fas fa-minus\"></i></span></button>"
			
			newDiv += "<form><div><span><select name=\"sound groups\">"
			newDiv += "<option value=\"all\">Global</option>";
			newDiv += "<optgroup label=\"Your groups\">"
			Settings.local_groups().forEach(group => {
				newDiv += "<option value=\""+group.userIds.toString()+"\">" + group.name + "</option>";
			});
			newDiv += "</optgroup><optgroup label=\"Users\">"
			game.users.forEach( user => {
				//if(!user.active) return;
				newDiv += "<option value=\""+user.id+"\">" + (user.isGM ? user.name : user.character.name) + "</option>";
			});
			newDiv += "</optgroup></select></span></div></form>"
			
			newDiv += "</div>"
			
			
			
			div.innerHTML += newDiv;
			
			newDiv = div.getElementsByTagName("select")[0]
			newDiv.style.width = "calc(100% - 40px)"
			newDiv.style.float = "right"
			newDiv.style.height = "26px"
			newDiv.style.backgroundColor = "#f0f0e0"
			newDiv.style.margin = "1px"
			newDiv.onchange = this._onSelectedGroupChange.bind(this)
			
			newDiv = newDiv.parentNode.parentNode.parentNode.parentNode.childNodes[0]
			newDiv.style.width = "17px"
			newDiv.style.margin = "1px"
			newDiv.style.padding = "0px"
			newDiv.style.height = "26px"
			newDiv.style.fontSize = "var(--font-size-12)"
			newDiv.style.float = "left"
			newDiv.onclick = this._onNewGroup.bind(this)
			
			newDiv = newDiv.parentNode.childNodes[1]
			newDiv.style.width = "17px"
			newDiv.style.margin = "1px"
			newDiv.style.padding = "0px"
			newDiv.style.height = "26px"
			newDiv.style.fontSize = "var(--font-size-12)"
			newDiv.style.float = "left"
			newDiv.onclick = this._onDeleteGroup.bind(this)
			
		});
	}
	
    super.activateListeners(html);

    // Volume sliders
    html.find('.global-volume-slider').change(this._onGlobalVolume.bind(this));
    html.find('.sound-volume').change(this._onSoundVolume.bind(this));

    // Collapse/Expand
    html.find(".playlist-name").click(this._onPlaylistCollapse.bind(this));
    html.find("#global-volume .playlist-header").click(this._onVolumeCollapse.bind(this))

    // Currently playing pinning
    html.find("#currently-playing .pin").click(this._onPlayingPin.bind(this));

    // Playlist Control Events
    html.on("click", "a.sound-control", event => {
      event.preventDefault();
      const btn = event.currentTarget;
      const action = btn.dataset.action;
      if (!action || btn.classList.contains("disabled")) return;

      // Delegate to Playlist and Sound control handlers
      switch (action) {
        case "playlist-mode":
          return this._onPlaylistToggleMode(event);
        case "playlist-play":
        case "playlist-stop":
          return this._onPlaylistPlay(event, action === "playlist-play");
        case "playlist-forward":
        case "playlist-backward":
          return this._onPlaylistSkip(event, action);
        case "sound-create":
          return this._onSoundCreate(event);
        case "sound-pause":
        case "sound-play":
        case "sound-stop":
          return this._onSoundPlay(event, action);
        case "sound-repeat":
          return this._onSoundToggleMode(event);
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle global volume change for the playlist sidebar
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onGlobalVolume(event) {
    event.preventDefault();
    const slider = event.currentTarget;
    const volume = AudioHelper.inputToVolume(slider.value);
    return game.settings.set("core", slider.name, volume);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  collapseAll() {
    super.collapseAll();
    const el = this.element[0];
    for ( let p of el.querySelectorAll("li.playlist") ) {
      this._collapse(p, true);
    }
    this._expanded.clear();
    this._collapse(el.querySelector("#global-volume"), true);
    this._volumeExpanded = false;
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist collapse toggle
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onPlaylistCollapse(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".playlist");
    const playlistId = li.dataset.documentId;
    const wasExpanded = this._expanded.has(playlistId);
    this._collapse(li, wasExpanded);
    if ( wasExpanded ) this._expanded.delete(playlistId);
    else this._expanded.add(playlistId);
  }

  /* -------------------------------------------- */

  /**
   * Handle global volume control collapse toggle
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onVolumeCollapse(event) {
    event.preventDefault();
    const div = event.currentTarget.parentElement;
    this._volumeExpanded = !this._volumeExpanded;
    this._collapse(div, !this._volumeExpanded);
  }

  /* -------------------------------------------- */

  /**
   * Helper method to render the expansion or collapse of playlists
   * @private
   */
  _collapse(el, collapse, speed = 250) {
    const ol = el.querySelector(".playlist-sounds");
    const icon = el.querySelector("i.collapse");
    if (collapse) { // Collapse the sounds
      $(ol).slideUp(speed, () => {
        el.classList.add("collapsed");
        icon.classList.replace("fa-angle-down", "fa-angle-up");
      });
    }
    else { // Expand the sounds
      $(ol).slideDown(speed, () => {
        el.classList.remove("collapsed");
        icon.classList.replace("fa-angle-up", "fa-angle-down");
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist playback state changes
   * @param {MouseEvent} event    The initial click event
   * @param {boolean} playing     Is the playlist now playing?
   * @private
   */
  _onPlaylistPlay(event, playing) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
    const do_remote = (!game.user.isGM)
    if ( playing ){
		if(do_remote) return remoteAction("playlist-playAll", "GM", {target: li.dataset.documentId})
		LocalSound.sendRemoteForceNotif(playlist.id, "all")
		return playlist.playAll();
	} else {
		if(do_remote) return remoteAction("playlist-stopAll", "GM", {target: li.dataset.documentId})
		LocalSound.sendRemoteForceNotif(playlist.id, "all")
		return playlist.stopAll();
	}
  }

  /* -------------------------------------------- */

  /**
   * Handle advancing the playlist to the next (or previous) sound
   * @param {MouseEvent} event    The initial click event
   * @param {string} action       The control action requested
   * @private
   */
  _onPlaylistSkip(event, action) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
    
    const do_remote = (!game.user.isGM)
    if(do_remote) return sendRemoteRequest({
	action: "playlist-skip",
	target: li.dataset.documentId,
	data: (action === "playlist-forward" ? 1 : -1)
    })
    
    LocalSound.sendRemoteForceNotif(playlist.id, "all")
    return playlist.playNext(undefined, {direction: action === "playlist-forward" ? 1 : -1});
  }

  /* -------------------------------------------- */

  /**
   * Handle cycling the playback mode for a Playlist
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onPlaylistToggleMode(event) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
    return playlist.cycleMode();
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist track addition request
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onSoundCreate(event) {
    const li = $(event.currentTarget).parents('.playlist');
    const playlist = game.playlists.get(li.data("documentId"));
    const sound = new PlaylistSound({name: game.i18n.localize("SOUND.New")}, {parent: playlist});
    sound.sheet.render(true, {top: li[0].offsetTop, left: window.innerWidth - 670});
  }

  /* -------------------------------------------- */

  /**
   * Modify the playback state of a Sound within a Playlist
   * @param {MouseEvent} event    The initial click event
   * @param {string} action       The sound control action performed
   * @private
   */
  _onSoundPlay(event, action) {
    const li = event.currentTarget.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);
    const do_remote = (!game.user.isGM)
    switch ( action ) {
      case "sound-play":
	if(do_remote) return remoteAction("sound-play", "GM", {target: li.dataset.soundId, playlist: li.dataset.playlistId})
	LocalSound.sendRemoteForceNotif(playlist.id, "all")
	return playlist.playSound(sound);
      case "sound-pause":
	if(do_remote) return remoteAction("sound-pause", "GM", {target: li.dataset.soundId, playlist: li.dataset.playlistId})
        LocalSound.sendRemoteForceNotif(playlist.id, "all")
	return sound.update({playing: false, pausedTime: sound.sound.currentTime});
      case "sound-stop":
	if(do_remote) return remoteAction("sound-stop", "GM", {target: li.dataset.soundId, playlist: li.dataset.playlistId})
	LocalSound.sendRemoteForceNotif(playlist.id, "all")
	return playlist.stopSound(sound);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle volume adjustments to sounds within a Playlist
   * @param {Event} event   The initial change event
   * @private
   */
  _onSoundVolume(event) {
    event.preventDefault();
    const slider = event.currentTarget;
    const li = slider.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);

    // Get the desired target volume
    const volume = AudioHelper.inputToVolume(slider.value);
    if ( volume === sound.data.volume ) return;

    // Immediately apply a local adjustment
    if ( sound.sound ) {
      const localVolume = volume * game.settings.get("core", "globalPlaylistVolume");
      sound.sound.fade(localVolume, {duration: PlaylistSound.VOLUME_DEBOUNCE_MS});
    }

    // Debounce a change to the database
    if ( sound.isOwner ) sound.debounceVolume(volume);
  }

  /* -------------------------------------------- */

  /**
   * Handle changes to the sound playback mode
   * @param {Event} event   The initial click event
   * @private
   */
  _onSoundToggleMode(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);
    return sound.update({repeat: !sound.data.repeat});
  }

  /* -------------------------------------------- */

  _onPlayingPin() {
    const location = this._playingLocation === "top" ? "bottom" : "top";
    return game.settings.set("core", "playlist.playingLocation", location);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onSearchFilter(event, query, rgx, html) {
    const isSearch = !!query;
    const playlistIds = new Set();
    const soundIds = new Set();
    const folderIds = new Set();

    // Match documents and folders
    if (isSearch) {

      // Match Playlists and Sounds
      for (let d of this.documents) {
        let matched = false;
        for (let s of d.sounds) {
          if (s.playing || rgx.test(SearchFilter.cleanQuery(s.name))) {
            soundIds.add(s.id);
            matched = true;
          }
        }
        if (matched || d.playing || rgx.test(SearchFilter.cleanQuery(d.name))) {
          playlistIds.add(d.id);
          if (d.data.folder) folderIds.add(d.data.folder);
        }
      }

      // Include parent Folders
      const folders = this.folders.sort((a, b) => a.depth - b.depth);
      for (let f of folders) {
        if (folderIds.has(f.id) && f.data.parent) {
          folderIds.add(f.data.parent);
        }
      }
    }

    // Toggle each directory item
    for (let el of html.querySelectorAll(".directory-item")) {
      if (el.classList.contains("global-volume")) continue;

      // Playlists
      if (el.classList.contains("document")) {
        const pid = el.dataset["documentId"];
        let mp = !isSearch || playlistIds.has(pid);
        el.style.display = mp ? "flex" : "none";

        // Sounds
        const sounds = el.querySelector(".playlist-sounds");
        for (let li of sounds.children ) {
          let ms = !isSearch || soundIds.has(li.dataset["soundId"])
          li.style.display = ms ? "flex" : "none";
          if ( ms ) mp = true;
        }
        let showExpanded = this._expanded.has(pid) || (isSearch && mp);
        el.classList.toggle("collapsed", !showExpanded);
      }

      // Folders
      else if (el.classList.contains("folder")) {
        let hidden = isSearch && !folderIds.has(el.dataset["folderId"]);
        el.style.display = hidden ? "none" : "flex";
        let expanded = (isSearch && folderIds.has(el.dataset["folderId"])) ||
          (!isSearch && game.folders._expanded[el.dataset.folderId]);
        el.classList.toggle("collapsed", !expanded);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Update the displayed timestamps for all currently playing audio sources.
   * Runs on an interval every 1000ms.
   * @private
   */
  _updateTimestamps() {
    if ( !this._playingSounds.length ) return;
    const playing = this.element.find("#currently-playing")[0];
    if ( !playing ) return;
    for ( let sound of this._playingSounds ) {
      const li = playing.querySelector(`.sound[data-sound-id="${sound.id}"]`);
      if ( !li ) continue;

      // Update current and max playback time
      const current = li.querySelector("span.current");
      const ct = sound.playing ? sound.sound.currentTime : sound.data.pausedTime;
      if ( current ) current.textContent = this._formatTimestamp(ct);
      const max = li.querySelector("span.duration");
      if ( max ) max.textContent = this._formatTimestamp(sound.sound.duration);

      // Remove the loading spinner
      const play = li.querySelector("a.pause i.fas");
      if ( play.classList.contains("fa-spinner") ) {
        play.classList.remove("fa-spin");
        play.classList.replace("fa-spinner", "fa-pause");
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Format the displayed timestamp given a number of seconds as input
   * @param {number} seconds    The current playback time in seconds
   * @returns {string}          The formatted timestamp
   * @private
   */
  _formatTimestamp(seconds) {
    if ( seconds === Infinity ) return "∞";
    seconds = seconds ?? 0;
    let minutes = Math.floor(seconds / 60);
    seconds = Math.round(seconds % 60);
    return `${minutes}:${seconds.paddedString(2)}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _contextMenu(html) {
    super._contextMenu(html);
    /**
     * A hook event that fires when the context menu for a Sound in the PlaylistDirectory is constructed.
     * @function getPlaylistDirectorySoundContext
     * @memberof hookEvents
     * @param {jQuery} html                     The HTML element to which the context options are attached
     * @param {ContextMenuEntry[]} entryOptions The context menu entries
     */
    ContextMenu.create(this, html, ".playlist .sound", this._getSoundContextOptions(), "SoundContext");
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getFolderContextOptions() {
    const options = super._getFolderContextOptions();
    //options.findSplice(o => o.name === "PERMISSION.Configure");
    return options;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getEntryContextOptions() {
    const options = super._getEntryContextOptions();
    //options.findSplice(o => o.name === "PERMISSION.Configure");
    options.unshift({
      name: "PLAYLIST.Edit",
      icon: '<i class="fas fa-edit"></i>',
	  condition: li => {
	      const playlist = game.playlists.get(li.data("document-id"));
	      return Settings.can_edit(game.userId, playlist);
	  },
      callback: li => {
        const playlist = game.playlists.get(li.data("document-id"));
        const sheet = playlist.sheet;
        sheet.render(true, this.popOut ? {} : {
          top: li[0].offsetTop - 24,
          left: window.innerWidth - ui.sidebar.position.width - sheet.options.width - 10
        });
      }
    })
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Get context menu options for individual sound effects
   * @return {Object}   The context options for each sound
   * @private
   */
  _getSoundContextOptions() {
    return [
      {
        name: "PLAYLIST.SoundEdit",
        icon: '<i class="fas fa-edit"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          const sheet = sound.sheet;
          sheet.render(true, this.popOut ? {} : {
            top: li[0].offsetTop - 24,
            left: window.innerWidth - ui.sidebar.position.width - sheet.options.width - 10
          });
        }
      },
      {
        name: "PLAYLIST.SoundPreload",
        icon: '<i class="fas fa-download"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          game.audio.preload(sound);
        }
      },
      {
        name: "PLAYLIST.SoundDelete",
        icon: '<i class="fas fa-trash"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          return sound.deleteDialog({
            top: Math.min(li[0].offsetTop, window.innerHeight - 350),
            left: window.innerWidth - 720
          })
        }
      },
    ];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragStart(event) {
    const target = event.currentTarget;
    if ( target.classList.contains("playlist-name") ) return super._onDragStart(event);
    const sound = target.closest(".sound");
    event.dataTransfer.setData("text/plain", JSON.stringify({
      playlistId: sound.dataset.playlistId,
      soundId: sound.dataset.soundId,
      type: "PlaylistSound"
    }));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if ( data.type !== "PlaylistSound" ) return super._onDrop(event);

    // Reference the target playlist and sound elements
    const target = event.target.closest(".sound, .playlist");
    if ( !target ) return false;
    const playlist = game.playlists.get(data.playlistId);
    if(!Settings.can_edit(game.userId, playlist)) return false;
    const sound = playlist.sounds.get(data.soundId);
    const otherPlaylistId = target.dataset.documentId || target.dataset.playlistId;

    // Copying to another playlist.
    if ( otherPlaylistId !== data.playlistId ) {
      const otherPlaylist = game.playlists.get(otherPlaylistId);
      return PlaylistSound.implementation.create(sound.toObject(), {parent: otherPlaylist});
    }

    // If there's nothing to sort relative to, or the sound was dropped on itself, do nothing.
    const targetId = target.dataset.soundId;
    if ( !targetId || (targetId === data.soundId) ) return false;
    sound.sortRelative({
      target: playlist.sounds.get(targetId),
      siblings: playlist.sounds.filter(s => s.id !== data.soundId)
    });
  }
}

export default PlaylistDirectory
