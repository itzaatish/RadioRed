import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const stationData = [
  { id: '95.0-fm', name: 'Station', frequency: '95.0 FM', displayText: 'just you and me' },
  { id: 'late-night-fm', name: 'Late Night FM', frequency: '98.4 FM', displayText: 'the night we got lost' },
  { id: 'memory-fm', name: 'Memory FM', frequency: '101.7 FM', displayText: 'a little song for us' },
  { id: 'velvet-fm', name: 'Velvet FM', frequency: '88.9 FM', displayText: 'your voice in the dark' },
]

function createToneDataUrl(seed) {
  const sampleRate = 22050
  const durationSeconds = 5
  const frameCount = sampleRate * durationSeconds
  const buffer = new ArrayBuffer(44 + frameCount * 2)
  const view = new DataView(buffer)

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + frameCount * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, frameCount * 2, true)

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate
    const baseFrequency = 180 + seed * 22
    const wave = Math.sin(2 * Math.PI * baseFrequency * t)
    const shimmer = Math.sin(2 * Math.PI * (baseFrequency * 0.75) * t)
    const envelope = Math.sin((Math.PI * i) / frameCount)
    const sample = ((wave * 0.6 + shimmer * 0.4) * envelope * 0.22) * 32767
    view.setInt16(44 + i * 2, sample, true)
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.3 4.7 13A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 7.3 6.6L12 20.3Z" />
    </svg>
  )
}

function WaveIcon({ mirrored = false }) {
  return (
    <svg viewBox="0 0 52 22" className={mirrored ? 'wave-icon mirrored' : 'wave-icon'} aria-hidden="true">
      <path d="M2 11h5.5c.8 0 1.8-1.7 2.6-3.3.9-1.8 1.8-3.2 2.7-3.2s1.8 1.4 2.7 3.2c.8 1.6 1.8 3.3 2.6 3.3h5.5" />
      <path d="M25 11h5.5c.8 0 1.8-1.7 2.6-3.3.9-1.8 1.8-3.2 2.7-3.2s1.8 1.4 2.7 3.2c.8 1.6 1.8 3.3 2.6 3.3H49" />
    </svg>
  )
}

function RadioMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.2A9 9 0 0 1 12 3a9 9 0 0 1 9 8.2m-15.9 1.4A6.6 6.6 0 0 1 12 7.7a6.6 6.6 0 0 1 6.8 5m-3.5 2.1a3.3 3.3 0 1 1-6.6 0 3.3 3.3 0 0 1 6.6 0Z" />
    </svg>
  )
}

function PlayIcon({ isPlaying }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {isPlaying ? (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1.5" />
          <rect x="14" y="5" width="4" height="14" rx="1.5" />
        </>
      ) : (
        <path d="M8 5v14l11-7-11-7Z" />
      )}
    </svg>
  )
}

function ArrowIcon({ direction = 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={direction === 'left' ? 'arrow left' : 'arrow right'}>
      {direction === 'left' ? (
        <path d="M14.5 6.5 8.5 12l6 5.5" />
      ) : (
        <path d="M9.5 6.5 15.5 12l-6 5.5" />
      )}
    </svg>
  )
}

function ChevronIcon({ isOpen }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={isOpen ? 'chevron open' : 'chevron'}>
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  )
}

function App() {
  const [stationIndex, setStationIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const audioRef = useRef(null)

  const stations = useMemo(                                    /// this creates a memoized array of station at the very start and this persists
    () =>
      stationData.map((station, index) => ({
        ...station,
        audioSrc: createToneDataUrl(index + 1),
      })),
    [],
  )

  const currentStation = stations[stationIndex]

  // useEffect(() => {
  //   return () => {
  //     stations.forEach((station) => URL.revokeObjectURL(station.audioSrc))
  //   }
  // }, [stations])

  useEffect(() => {
    console.log('Current Station:', currentStation , audioRef.current.src)
    const audio = audioRef.current
    if (!audio) return

    audio.src = currentStation.audioSrc
    audio.load()

    audio.onerror = () => console.error('Failed to load audio source')
    if (playing) {
      audio.play().catch(() => setPlaying(false))
    } else {
      console.log('Pausing audio for station:', currentStation.name)
      audio.pause()
    }
  }, [currentStation, playing])

  const togglePlay = async () => {
    const audio = audioRef.current

    if (!audio) return

    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }

    try {
      await audio.play()
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
  }

  const selectStation = (index, autoplay = false) => {
    setStationIndex(index)
    setIsOpen(false)
    setPlaying(autoplay)
  }

  const handleNext = () => {
    const nextIndex = (stationIndex + 1) % stations.length
    selectStation(nextIndex, playing)
  }

  const handlePrevious = () => {
    const previousIndex = (stationIndex - 1 + stations.length) % stations.length
    selectStation(previousIndex, playing)
  }

  const waveformBars = [12, 20, 28, 36, 56, 46, 33, 26, 22, 18, 29, 40, 52, 34, 20, 16, 24, 30, 42, 34, 18]

  return (
    <main className={playing ? 'app-shell playing' : 'app-shell'}>
      <div className="radio-stage" aria-label="Love Radio player">
        <button className="nav-button" type="button" onClick={handlePrevious} aria-label="Previous station">
          <ArrowIcon direction="left" />
        </button>

        <div className="radio-card">
          <header className="frequency-header">
            <WaveIcon />
            <span className="frequency">{currentStation.frequency}</span>
            <WaveIcon mirrored />
          </header>

          <div className="divider-heart" aria-hidden="true">
            <span className="line" />
            <HeartIcon />
            <span className="line" />
          </div>

          <div className="display-panel">
            <div key={currentStation.displayText} className="display-text">
              {currentStation.displayText}
            </div>
          </div>

          <div className={playing ? 'waveform is-playing' : 'waveform'} aria-label="Waveform">
            {waveformBars.map((bar, index) => (
              <span key={`${bar}-${index}`} className="bar" style={{ '--bar-height': `${bar}px` }} />
            ))}
          </div>
        </div>

        <button className="nav-button" type="button" onClick={handleNext} aria-label="Next station">
          <ArrowIcon direction="right" />
        </button>
      </div>

      <div className="control-row">
        <span className="sparkle left" aria-hidden="true" />
        <button className={playing ? 'play-button playing' : 'play-button'} type="button" onClick={togglePlay} aria-label={playing ? 'Pause radio' : 'Play radio'}>
          <PlayIcon isPlaying={playing} />
        </button>
        <span className="sparkle right" aria-hidden="true" />
      </div>

      <div className="station-selector">
        <button className="selector-button" type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
          <span className="selector-label">
            <RadioMiniIcon />
            <span>Station</span>
          </span>
          <ChevronIcon isOpen={isOpen} />
        </button>

        {isOpen && (
          <div className="station-menu" role="listbox" aria-label="Select a station">
            {stations.map((station, index) => (
              <button
                key={station.id}
                type="button"
                className={index === stationIndex ? 'station-option selected' : 'station-option'}
                onClick={() => selectStation(index, playing)}
              >
                <span>{station.name}</span>
                <span>{station.frequency}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <audio ref={audioRef} preload="auto" onEnded={() => handleNext()} />
    </main>
  )
}

export default App
