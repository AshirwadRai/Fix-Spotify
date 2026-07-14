import { useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Repeat, Shuffle, Heart, ListMusic, MonitorSpeaker, Loader2, WifiOff, AlertCircle } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { FastAverageColor } from 'fast-average-color';
import { cleanText, getBestArtworkUrl, splitArtists } from '../utils/tracks';
import { useLikedSongs, toggleLiked } from '../utils/likes';

export function PlayerBar({ onColorChange, showNowPlaying, onToggleNowPlaying, onNavigate, onLikeChange, onOpenArtist, onOpenAlbum }) {
  const { 
    currentTrack, isPlaying, isLoading, playbackError,
    togglePlay, progress, duration, seek, 
    volume, changeVolume, playNext, playPrevious,
    shuffle, toggleShuffle, repeat, toggleRepeat, streamQuality,
  } = usePlayer();
  
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(1);
  // Liked state from the shared reactive store, so it stays in sync no matter
  // where a like is toggled (player bar, now-playing, context menu, any view).
  const likedSongs = useLikedSongs();
  const liked = currentTrack
    ? likedSongs.some(t => cleanText(t.title) === cleanText(currentTrack.title) && cleanText(t.artist) === cleanText(currentTrack.artist))
    : false;

  // Dynamic color extraction
  useEffect(() => {
    const artworkUrl = getBestArtworkUrl(currentTrack);
    if (artworkUrl) {
      const fac = new FastAverageColor();
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = artworkUrl;
      
      img.onload = () => {
        try {
          const color = fac.getColor(img);
          if (onColorChange) {
            onColorChange(`${color.value[0]}, ${color.value[1]}, ${color.value[2]}`);
          }
        } catch {
          if (onColorChange) onColorChange("83, 83, 83");
        }
      };
      
      img.onerror = () => {
        if (onColorChange) onColorChange("83, 83, 83");
      };
    } else {
      if (onColorChange) onColorChange("18, 18, 18");
    }
  }, [currentTrack, onColorChange]);

  const toggleLike = () => {
    if (!currentTrack) return;
    toggleLiked(currentTrack);
    if (onLikeChange) onLikeChange();
  };

  const formatTime = (time) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSeek = (e) => {
    seek(Number(e.target.value));
  };

  const handleVolume = (e) => {
    const val = Number(e.target.value);
    changeVolume(val);
    if (val > 0 && isMuted) setIsMuted(false);
    if (val === 0 && !isMuted) setIsMuted(true);
  };

  const toggleMute = () => {
    if (isMuted) {
      changeVolume(prevVolume > 0 ? prevVolume : 1);
      setIsMuted(false);
    } else {
      setPrevVolume(volume);
      changeVolume(0);
      setIsMuted(true);
    }
  };

  const renderVolumeIcon = () => {
    const v = isMuted ? 0 : volume;
    if (v === 0) return <VolumeX className="w-4 h-4" />;
    if (v < 0.5) return <Volume1 className="w-4 h-4" />;
    return <Volume2 className="w-4 h-4" />;
  };

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
  const volumePercent = (isMuted ? 0 : volume) * 100;
  const artworkUrl = getBestArtworkUrl(currentTrack);

  // Empty state — no track selected
  if (!currentTrack) {
    return (
      <div className="h-[72px] bg-spotify-black border-t border-spotify-elevated-highlight flex items-center justify-between px-4 z-50 relative">
        <div className="w-[30%]"></div>
        <div className="flex flex-col items-center justify-center w-[40%] opacity-40 pointer-events-none">
          <div className="flex items-center gap-6 mb-1">
            <Shuffle className="w-4 h-4 text-spotify-text-subdued" />
            <SkipBack className="w-4 h-4 text-spotify-text-subdued" fill="currentColor" />
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
              <Play className="w-4 h-4 text-black" fill="currentColor" />
            </div>
            <SkipForward className="w-4 h-4 text-spotify-text-subdued" fill="currentColor" />
            <Repeat className="w-4 h-4 text-spotify-text-subdued" />
          </div>
          <div className="flex items-center gap-2 w-full max-w-md text-[11px] text-spotify-text-subdued">
            <span>0:00</span>
            <div className="flex-1 h-1 bg-spotify-elevated-highlight rounded-full"></div>
            <span>0:00</span>
          </div>
        </div>
        <div className="w-[30%]"></div>
      </div>
    );
  }

  return (
    <div className="h-[72px] bg-spotify-black border-t border-spotify-elevated-highlight flex items-center justify-between px-4 z-50 relative">
      {/* Track Info — Left */}
      <div className="flex items-center gap-3 w-[30%] min-w-0">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="w-14 h-14 object-cover rounded shadow-md shrink-0" />
        ) : (
          <div className="w-14 h-14 bg-spotify-elevated-highlight rounded shadow-md shrink-0 flex items-center justify-center">
            <span className="text-spotify-text-subdued text-lg">♪</span>
          </div>
        )}
        <div className="flex flex-col overflow-hidden mr-2">
          <span
            onClick={() => {
              const album = cleanText(currentTrack.album);
              if (album && onOpenAlbum) onOpenAlbum(album, splitArtists(currentTrack.artist)[0] || '');
            }}
            className={`text-sm font-medium text-white truncate ${cleanText(currentTrack.album) && onOpenAlbum ? 'hover:underline cursor-pointer' : ''}`}
            title={cleanText(currentTrack.title)}
          >
            {cleanText(currentTrack.title)}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-spotify-text-subdued truncate min-w-0" title={cleanText(currentTrack.artist)}>
              {splitArtists(currentTrack.artist).map((name, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-spotify-text-subdued">, </span>}
                  <span
                    onClick={() => onOpenArtist && onOpenArtist(name)}
                    className={onOpenArtist ? 'hover:underline hover:text-white cursor-pointer' : ''}
                  >
                    {name}
                  </span>
                </span>
              ))}
            </span>
            {streamQuality?.bitrate && (
              <span
                className="shrink-0 px-1.5 py-[1px] rounded text-[9px] font-bold uppercase bg-spotify-essential-bright-accent/20 text-spotify-essential-bright-accent tracking-wide"
                title={`Live stream quality${streamQuality.codec ? ` · ${streamQuality.codec.toUpperCase()}` : ''}`}
              >
                {streamQuality.bitrate} kbps
              </span>
            )}
          </div>
        </div>
        <button onClick={toggleLike} className={`shrink-0 transition-colors ${liked ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}>
          <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Controls — Center */}
      <div className="flex flex-col items-center justify-center w-[40%] max-w-[722px]">
        <div className="flex items-center gap-4 mb-1">
          <button 
            onClick={toggleShuffle} 
            className={`transition-colors relative ${shuffle ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}
          >
            <Shuffle className="w-4 h-4" />
            {shuffle && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-spotify-essential-bright-accent"></div>}
          </button>
          <button onClick={playPrevious} className="text-spotify-text-subdued hover:text-white transition-colors">
            <SkipBack className="w-4 h-4" fill="currentColor" />
          </button>
          <button 
            onClick={togglePlay}
            className="w-8 h-8 rounded-full bg-white hover:scale-105 flex items-center justify-center transition-all"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-black animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 text-black" fill="currentColor" />
            ) : (
              <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
            )}
          </button>
          <button onClick={playNext} className="text-spotify-text-subdued hover:text-white transition-colors">
            <SkipForward className="w-4 h-4" fill="currentColor" />
          </button>
          <button
            onClick={toggleRepeat}
            aria-pressed={repeat === 'one'}
            title={repeat === 'one' ? 'Repeat on — this song replays' : 'Repeat this song'}
            className={`transition-colors relative ${repeat === 'one' ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}
          >
            <Repeat className="w-4 h-4" />
            {repeat === 'one' && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-spotify-essential-bright-accent"></div>}
          </button>
        </div>
        
        {/* Progress Bar */}
        <div className="flex items-center gap-2 w-full text-[11px] text-spotify-text-subdued tabular-nums">
          <span className="w-10 text-right">{formatTime(progress)}</span>
          <div className="flex-1 group relative h-3 flex items-center">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={progress || 0}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1 bg-spotify-elevated-highlight rounded-full relative group-hover:h-1.5 transition-all">
              <div 
                className="absolute left-0 top-0 h-full bg-white group-hover:bg-spotify-essential-bright-accent rounded-full transition-colors"
                style={{ width: `${progressPercent}%` }}
              ></div>
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progressPercent}% - 6px)` }}
              ></div>
            </div>
          </div>
          <span className="w-10">{formatTime(duration)}</span>
        </div>

        {/* Error indicator */}
        {playbackError && (
          <div className="flex items-center gap-1.5 text-[11px] text-spotify-essential-warning mt-0.5 max-w-md">
            {!navigator.onLine ? (
              <WifiOff className="w-3 h-3 shrink-0" />
            ) : (
              <AlertCircle className="w-3 h-3 shrink-0" />
            )}
            <span className="truncate">{playbackError}</span>
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center justify-end gap-2 w-[30%]">
        <button
          onClick={() => onNavigate('queue')}
          className="text-spotify-text-subdued hover:text-white transition-colors p-2"
          title="Queue"
        >
          <ListMusic className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleNowPlaying}
          className={`transition-colors p-2 ${showNowPlaying ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}
          title="Now Playing View"
        >
          <MonitorSpeaker className="w-4 h-4" />
        </button>
        <button onClick={toggleMute} className="text-spotify-text-subdued hover:text-white transition-colors p-1">
          {renderVolumeIcon()}
        </button>
        <div className="group relative h-3 flex items-center w-24">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolume}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="w-full h-1 bg-spotify-elevated-highlight rounded-full relative group-hover:h-1.5 transition-all">
            <div 
              className="absolute left-0 top-0 h-full bg-white group-hover:bg-spotify-essential-bright-accent rounded-full transition-colors"
              style={{ width: `${volumePercent}%` }}
            ></div>
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${volumePercent}% - 6px)` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
