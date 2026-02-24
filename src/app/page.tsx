'use client'

import { useState, useCallback, useRef, useEffect, useSyncExternalStore, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Upload,
  FileText,
  Plus,
  Download,
  Trash2,
  Edit2,
  Check,
  X,
  Map as MapIcon,
} from 'lucide-react'

import dynamic from 'next/dynamic'

// ==================== КОНСТАНТЫ ====================
const STORAGE_KEY = 'fitness-tracker-data-v8' // Обновлено для сброса кэша
const GPX_STORAGE_KEY = 'fitness-tracker-gpx-v8'

// ==================== ТИПЫ ДАННЫХ ====================
interface GpxPoint {
  lat: number
  lon: number
  hr: number | null 
  time: string | null
  speed: number | null 
  distance: number 
  timestamp: number 
}

interface GpxData {
  date: string
  points: GpxPoint[]
  totalDistance: number
  totalTime: number
  avgSpeed: number
}

interface TrackRow {
  id: string
  date: string
  time: string 
  km: number
  h: number
  m: number
  drop: number | null
  hr: number | null
  totalMinutes: number
  speedKmh: number
  gpxData: GpxData | null
  dateTime: Date 
}

interface ParsedData {
  rows: TrackRow[]
  totalDistance: number
  totalTime: number
  avgSpeed: number
  totalRuns: number
  avgHr: number | null
  avgTemp: number | null
  dateFrom: string
  dateTo: string
}

const generateId = () => Math.random().toString(36).substring(2, 15)

// ==================== ХРАНИЛИЩЕ ДЛЯ LOCALSTORAGE ====================

const createLocalStorageStore = <T,>(key: string, initialValue: T) => {
  let listeners: Array<() => void> = []
  let cachedValue: T = initialValue
  let initialized = false

  const getValue = (): T => {
    if (typeof window === 'undefined') return initialValue
    if (initialized) return cachedValue
    try {
      const item = localStorage.getItem(key)
      if (item) {
        cachedValue = JSON.parse(item)
      }
    } catch { /* ignore */ }
    initialized = true
    return cachedValue
  }

  const setValue = (newValue: T) => {
    cachedValue = newValue
    initialized = true
    try {
      localStorage.setItem(key, JSON.stringify(newValue))
    } catch { /* ignore */ }
    listeners.forEach(listener => listener())
  }

  const subscribe = (listener: () => void) => {
    listeners.push(listener)
    return () => { listeners = listeners.filter(l => l !== listener) }
  }

  return { getValue, setValue, subscribe }
}

const dataStore = createLocalStorageStore<ParsedData | null>(STORAGE_KEY, null)

const parseDate = (dateStr: string): Date => {
  const [day, month, year] = dateStr.split('.').map(Number)
  return new Date(year, month - 1, day)
}

const formatDateShort = (dateStr: string): string => {
  const [day, month, year] = dateStr.split('.')
  return `${day}.${month}.${year?.slice(-2)}`
}

const sortByDate = (rows: TrackRow[]): TrackRow[] => {
  return [...rows].sort((a, b) => {
    const timeA = a.dateTime ? new Date(a.dateTime).getTime() : 0
    const timeB = b.dateTime ? new Date(b.dateTime).getTime() : 0
    const safeTimeA = isNaN(timeA) ? 0 : timeA
    const safeTimeB = isNaN(timeB) ? 0 : timeB
    return safeTimeA - safeTimeB
  })
}

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const parseGPX = (gpxContent: string, date: string): GpxData | null => {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(gpxContent, 'text/xml')
    const trkpts = xmlDoc.querySelectorAll('trkpt')
    if (trkpts.length === 0) return null

    const rawPoints: { lat: number; lon: number; hr: number | null; time: Date | null; dist: number; ts: number }[] = []
    let totalDist = 0
    
    let prevPt: { lat: number; lon: number; time: Date | null } | null = null
    let startTime: Date | null = null

    trkpts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') || '0')
      const lon = parseFloat(pt.getAttribute('lon') || '0')
      const eleElement = pt.querySelector('ele')
      const timeElement = pt.querySelector('time')
      
      const hr = eleElement ? Math.round(parseFloat(eleElement.textContent || '0')) : null
      const timeStr = timeElement ? timeElement.textContent : null
      const time = timeStr ? new Date(timeStr) : null

      if (!startTime && time) startTime = time

      let dist = 0
      if (prevPt) {
        dist = haversineDistance(prevPt.lat, prevPt.lon, lat, lon)
      }
      totalDist += dist

      rawPoints.push({
        lat, lon, hr, time,
        dist: totalDist,
        ts: time && startTime ? (time.getTime() - startTime.getTime()) / 1000 : 0
      })

      prevPt = { lat, lon, time }
    })

    if (rawPoints.length === 0) return null

    const points: GpxPoint[] = []
    
    // Окна сглаживания
    const speedWindowSeconds = 120 
    const hrWindowSeconds = 30 
    
    let speedWindowStart = 0
    let hrWindowStart = 0
    
    for (let i = 0; i < rawPoints.length; i++) {
      const current = rawPoints[i]
      
      // --- Скорость ---
      while (current.ts - rawPoints[speedWindowStart].ts > speedWindowSeconds) {
        speedWindowStart++
      }
      
      const startPoint = rawPoints[speedWindowStart]
      const distInWindow = current.dist - startPoint.dist
      const timeInWindow = current.ts - startPoint.ts
      
      let speed: number | null = null
      if (timeInWindow > 0) {
        const rawSpeed = (distInWindow / 1000) / (timeInWindow / 3600)
        if (rawSpeed <= 50) {
          speed = Math.round(rawSpeed * 10) / 10
        } else {
           const prevSpeed = points.length > 0 ? points[points.length - 1].speed : null
           if (prevSpeed !== null && prevSpeed < 50) {
             speed = prevSpeed
           } else {
             speed = null
           }
        }
      }

      // --- ЧСС ---
      while (current.ts - rawPoints[hrWindowStart].ts > hrWindowSeconds) {
        hrWindowStart++
      }

      let smoothedHr: number | null = null
      let hrSum = 0
      let hrCount = 0
      
      for (let k = hrWindowStart; k <= i; k++) {
        if (rawPoints[k].hr !== null) {
          hrSum += rawPoints[k].hr!
          hrCount++
        }
      }
      
      if (hrCount > 0) {
        smoothedHr = Math.round(hrSum / hrCount)
      }

      points.push({
        lat: current.lat,
        lon: current.lon,
        hr: smoothedHr,
        time: current.time ? current.time.toISOString() : null,
        speed: speed,
        distance: Math.round(current.dist),
        timestamp: current.ts
      })
    }

    const totalTime = rawPoints[rawPoints.length - 1].ts
    const avgSpeed = totalTime > 0 ? (totalDist / 1000) / (totalTime / 3600) : 0

    return {
      date,
      points,
      totalDistance: Math.round(totalDist),
      totalTime: Math.round(totalTime),
      avgSpeed: Math.round(avgSpeed * 10) / 10,
    }
  } catch (error) {
    console.error('Error parsing GPX:', error)
    return null
  }
}

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false })

function TrackMap({ gpxData, highlightedPointIndex }: { gpxData: GpxData | null, highlightedPointIndex: number | null }) {
  const [mounted, setMounted] = useState(false)
  const [L, setL] = useState<any>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('leaflet').then((leaflet) => {
        setL(leaflet.default)
        setMounted(true)
      })
    }
  }, [])

  if (!mounted || !gpxData || gpxData.points.length === 0) {
    return (
      <div className="h-[400px] bg-slate-700/50 rounded-lg flex items-center justify-center">
        <p className="text-slate-400">
          {mounted ? 'Нажмите на дату в таблице для загрузки GPX' : 'Загрузка карты...'}
        </p>
      </div>
    )
  }

  const points = gpxData.points
  const center: [number, number] = [points[0].lat, points[0].lon]
  const path: [number, number][] = points.map(p => [p.lat, p.lon])

  const activePoint = highlightedPointIndex !== null && points[highlightedPointIndex] 
    ? points[highlightedPointIndex] 
    : null

  return (
    <div className="h-[400px] rounded-lg overflow-hidden border border-slate-600">
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        <TileLayer
          attribution=''
          url="https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}.png"
        />
        <Polyline 
          positions={path} 
          pathOptions={{ color: '#22d3ee', weight: 3, opacity: 0.8 }}
        />
        {L && (
          <>
            <Marker position={path[0]} icon={L.divIcon({
              className: 'custom-marker',
              html: '<div style="background: #22c55e; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
              iconSize: [12, 12],
            })}>
              <Popup>Старт</Popup>
            </Marker>
            <Marker position={path[path.length - 1]} icon={L.divIcon({
              className: 'custom-marker',
              html: '<div style="background: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
              iconSize: [12, 12],
            })}>
              <Popup>Финиш</Popup>
            </Marker>
            
            {activePoint && (
              <Marker position={[activePoint.lat, activePoint.lon]} icon={L.divIcon({
                className: 'custom-marker',
                html: '<div style="background: #f59e0b; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })}>
                <Popup>
                  <div className="text-xs">
                    <div><b>Дистанция:</b> {(activePoint.distance/1000).toFixed(2)} км</div>
                    <div><b>Скорость:</b> {activePoint.speed ? activePoint.speed + ' км/ч' : '—'}</div>
                    <div><b>ЧСС:</b> {activePoint.hr ? activePoint.hr + ' уд/мин' : '—'}</div>
                  </div>
                </Popup>
              </Marker>
            )}
          </>
        )}
      </MapContainer>
    </div>
  )
}

export default function Home() {
  const data = useSyncExternalStore(
    dataStore.subscribe,
    dataStore.getValue,
    () => null
  )
  const setData = useCallback((newData: ParsedData | null | ((prev: ParsedData | null) => ParsedData | null)) => {
    if (typeof newData === 'function') {
      const prevValue = dataStore.getValue()
      const result = (newData as (prev: ParsedData | null) => ParsedData | null)(prevValue)
      dataStore.setValue(result)
    } else {
      dataStore.setValue(newData)
    }
  }, [])
  
  const [uploadedFileName, setUploadedFileName] = useState<string>('')
  const fileName = uploadedFileName || (data ? 'сохранённые данные' : '')
  
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const gpxInputRef = useRef<HTMLInputElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<TrackRow>>({})

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newWorkout, setNewWorkout] = useState({
    date: '', time: '', km: '', h: '', m: '', drop: '', hr: '',
  })

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [selectedGpxData, setSelectedGpxData] = useState<GpxData | null>(null)
  const [showGpxDialog, setShowGpxDialog] = useState(false)
  const [highlightedPointIndex, setHighlightedPointIndex] = useState<number | null>(null)

  const recalculateStats = useCallback((rows: TrackRow[]): ParsedData => {
    const totalDistance = rows.reduce((sum, r) => sum + r.km, 0)
    const totalTime = rows.reduce((sum, r) => sum + r.totalMinutes, 0)
    const avgSpeed = totalTime > 0 ? totalDistance / (totalTime / 60) : 0

    const hrValues = rows.filter(r => r.hr !== null).map(r => r.hr as number)
    const dropValues = rows.filter(r => r.drop !== null).map(r => r.drop as number)

    const sortedRows = sortByDate(rows)
    const dateFrom = sortedRows.length > 0 ? sortedRows[0].date : ''
    const dateTo = sortedRows.length > 0 ? sortedRows[sortedRows.length - 1].date : ''

    return {
      rows: sortedRows,
      totalDistance: Math.round(totalDistance),
      totalTime,
      avgSpeed: Math.round(avgSpeed),
      totalRuns: rows.length,
      avgHr: hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
      avgTemp: dropValues.length > 0 ? Math.round(dropValues.reduce((a, b) => a + b, 0) / dropValues.length) : null,
      dateFrom,
      dateTo,
    }
  }, [])

  const parseTimeFromFilename = (filename: string): string => {
    const match = filename.match(/_(\d{2})(\d{2})\.gpx$/i)
    if (match) {
      return `${match[1]}:${match[2]}`
    }
    return ''
  }

  const parseXML = useCallback((xmlContent: string): TrackRow[] => {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml')
    const rows = xmlDoc.querySelectorAll('row')

    const trackRows: TrackRow[] = []

    rows.forEach((row) => {
      const date = row.getAttribute('date') || ''
      const fileAttr = row.getAttribute('file') || ''
      const km = parseFloat(row.getAttribute('km') || '0')
      const h = parseInt(row.getAttribute('h') || '0')
      const m = parseInt(row.getAttribute('m') || '0')
      const dropAttr = row.getAttribute('drop')
      const hrAttr = row.getAttribute('hr')

      const timeStr = parseTimeFromFilename(fileAttr)
      
      const parts = date.split('.').map(Number);
      const day = parts[0] || 1;
      const month = parts[1] || 1;
      const year = parts[2] || 2000;
      
      let dateTime = new Date(year, month - 1, day)
      if (timeStr) {
        const [th, tm] = timeStr.split(':').map(Number)
        dateTime.setHours(th, tm, 0, 0)
      }

      const totalMinutes = h * 60 + m
      const speedKmh = totalMinutes > 0 ? (km / (totalMinutes / 60)) : 0

      trackRows.push({
        id: generateId(),
        date,
        time: timeStr,
        km: Math.round(km),
        h,
        m,
        drop: dropAttr !== null && dropAttr !== '' ? Math.round(parseFloat(dropAttr)) : null,
        hr: hrAttr !== null && hrAttr !== '' ? parseInt(hrAttr) : null,
        totalMinutes,
        speedKmh: Math.round(speedKmh),
        gpxData: null,
        dateTime,
      })
    })

    return sortByDate(trackRows)
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      setUploadedFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const rows = parseXML(content)
        setData(recalculateStats(rows))
      }
      reader.readAsText(file)
    },
    [parseXML, recalculateStats, setData]
  )

  const handleImportFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const newRows = parseXML(content)
        setData(prev => {
          if (!prev) return recalculateStats(newRows)
          const combinedRows = sortByDate([...prev.rows, ...newRows])
          return recalculateStats(combinedRows)
        })
      }
      reader.readAsText(file)
    },
    [parseXML, recalculateStats]
  )

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleImportChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImportFile(file)
    if (importInputRef.current) importInputRef.current.value = ''
  }, [handleImportFile])

  const startEditing = (row: TrackRow) => {
    setEditingId(row.id)
    setEditValues({ ...row })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditValues({})
  }

  const saveEditing = () => {
    if (!editValues) return
    setData(prev => {
      if (!prev) return prev
      const updatedRows = prev.rows.map(row => {
        if (row.id === editingId) {
          const km = editValues.km ?? row.km
          const h = editValues.h ?? row.h
          const m = editValues.m ?? row.m
          const totalMinutes = h * 60 + m
          const speedKmh = totalMinutes > 0 ? (km / (totalMinutes / 60)) : 0
          
          const parts = (editValues.date || row.date).split('.').map(Number);
          const day = parts[0] || 1;
          const month = parts[1] || 1;
          const year = parts[2] || 2000;
          const newDateTime = new Date(year, month - 1, day)
          
          if (editValues.time) {
            const [th, tm] = editValues.time.split(':').map(Number)
            newDateTime.setHours(th, tm, 0, 0)
          }

          return {
            ...row,
            ...editValues,
            km: Math.round(km),
            h, m,
            totalMinutes,
            speedKmh: Math.round(speedKmh),
            drop: editValues.drop !== null && editValues.drop !== '' ? Math.round(editValues.drop as number) : null,
            dateTime: newDateTime
          } as TrackRow
        }
        return row
      })
      return recalculateStats(updatedRows)
    })
    setEditingId(null)
    setEditValues({})
  }

  const deleteRow = (id: string) => {
    setData(prev => {
      if (!prev) return prev
      const filteredRows = prev.rows.filter(row => row.id !== id)
      return recalculateStats(filteredRows)
    })
  }

  const addWorkout = () => {
    const date = newWorkout.date
    const time = newWorkout.time
    
    const parts = date.split('.').map(Number);
    const day = parts[0] || 1;
    const month = parts[1] || 1;
    const year = parts[2] || 2000;
    
    const dateTime = new Date(year, month - 1, day)
    if (time) {
      const [th, tm] = time.split(':').map(Number)
      dateTime.setHours(th, tm, 0, 0)
    }

    const newRow: TrackRow = {
      id: generateId(),
      date,
      time,
      km: Math.round(parseFloat(newWorkout.km) || 0),
      h: parseInt(newWorkout.h) || 0,
      m: parseInt(newWorkout.m) || 0,
      drop: newWorkout.drop !== '' ? Math.round(parseFloat(newWorkout.drop)) : null,
      hr: newWorkout.hr !== '' ? parseInt(newWorkout.hr) : null,
      totalMinutes: (parseInt(newWorkout.h) || 0) * 60 + (parseInt(newWorkout.m) || 0),
      speedKmh: 0,
      gpxData: null,
      dateTime,
    }

    newRow.speedKmh = newRow.totalMinutes > 0
      ? Math.round(newRow.km / (newRow.totalMinutes / 60))
      : 0

    setData(prev => {
      if (!prev) return recalculateStats([newRow])
      const combinedRows = sortByDate([...prev.rows, newRow])
      return recalculateStats(combinedRows)
    })

    setNewWorkout({ date: '', time: '', km: '', h: '', m: '', drop: '', hr: '' })
    setIsAddDialogOpen(false)
  }

  const exportToXML = () => {
    if (!data) return
    let xmlContent = `<?xml version='1.0' encoding='utf-8'?>\n<tracks>`
    data.rows.forEach(row => {
      const dropAttr = row.drop !== null ? ` drop="${row.drop}"` : ''
      const hrAttr = row.hr !== null ? ` hr="${row.hr}"` : ''
      const fileAttr = row.time ? ` file="${row.date.replace(/\./g, '')}_${row.time.replace(':', '')}.gpx"` : ''
      xmlContent += `<row date="${row.date}" km="${row.km}" h="${row.h}" m="${row.m}"${dropAttr}${hrAttr}${fileAttr} />`
    })
    xmlContent += `</tracks>`

    const blob = new Blob([xmlContent], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tracks_export.xml'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const clearData = () => {
    setData(null)
    setUploadedFileName('')
    setSelectedGpxData(null)
    setSelectedRowId(null)
    setHighlightedPointIndex(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleDateClick = (rowId: string) => {
    const row = data?.rows.find(r => r.id === rowId)
    if (!row) return

    setSelectedRowId(rowId)
    
    if (row.gpxData) {
      setSelectedGpxData(row.gpxData)
      setShowGpxDialog(true)
    } else {
      setSelectedGpxData(null)
      setTimeout(() => { gpxInputRef.current?.click() }, 100)
    }
  }

  const handleGpxLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedRowId) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      const currentRow = data?.rows.find(r => r.id === selectedRowId)
      const gpxData = parseGPX(content, currentRow?.date || '')
      
      if (gpxData) {
        setSelectedGpxData(gpxData)
        setData(prev => {
          if (!prev) return prev
          const updatedRows = prev.rows.map(row => {
            if (row.id === selectedRowId) {
              return { ...row, gpxData }
            }
            return row
          })
          return recalculateStats(updatedRows)
        })
      }
    }
    reader.readAsText(file)
    if (gpxInputRef.current) gpxInputRef.current.value = ''
  }

  const handleUpdateGpx = () => {
    setShowGpxDialog(false)
    setSelectedGpxData(null)
    setTimeout(() => { gpxInputRef.current?.click() }, 100)
  }

  const handleUseExistingGpx = () => {
    const existingRow = data?.rows.find(r => r.id === selectedRowId)
    if (existingRow?.gpxData) {
      setSelectedGpxData(existingRow.gpxData)
    }
    setShowGpxDialog(false)
  }

  const chartData = data?.rows.map((row) => ({
    date: row.date,
    shortDate: parseDate(row.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    km: row.km,
    speedKmh: row.speedKmh,
    drop: row.drop,
    hr: row.hr,
  })) || []

  // ИЗМЕНЕНО: Прореживание данных (децимация) для гладкого графика
  // Берем только одну точку на каждые 50 метров дистанции
  const gpxChartData = useMemo(() => {
    if (!selectedGpxData) return []
    
    const result: any[] = []
    const points = selectedGpxData.points
    const minStepMeters = 50 // Шаг прореживания
    
    let lastDist = -minStepMeters
    
    points.forEach((p, idx) => {
      // Добавляем точку, если прошли достаточное расстояние или это первая/последняя точка
      if (p.distance >= lastDist + minStepMeters || idx === 0 || idx === points.length - 1) {
        result.push({
          originalIndex: idx,
          distance: Math.round(p.distance / 100) / 10, // км
          speed: p.speed,
          hr: p.hr,
        })
        lastDist = p.distance
      }
    })
    
    return result
  }, [selectedGpxData])

  const gpxChartTicks = (() => {
    if (!selectedGpxData) return []
    const totalKm = selectedGpxData.totalDistance / 1000
    const ticks = []
    for (let i = 0; i <= totalKm; i++) {
      ticks.push(i)
    }
    return ticks
  })()

  const selectedRow = data?.rows.find(r => r.id === selectedRowId)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">
            Анализатор тренировок
          </h1>
        </div>

        <input ref={gpxInputRef} type="file" accept=".gpx" onChange={handleGpxLoad} className="hidden" />

        <Dialog open={showGpxDialog} onOpenChange={setShowGpxDialog}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white">
            <DialogHeader>
              <DialogTitle>GPX файл уже загружен</DialogTitle>
              <DialogDescription className="text-slate-400">
                Для записи {selectedRow?.date} {selectedRow?.time ? `(${selectedRow.time})` : ''} уже есть GPX данные. Обновить?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleUseExistingGpx} className="border-slate-600">
                Показать старые
              </Button>
              <Button onClick={handleUpdateGpx} className="bg-cyan-600 hover:bg-cyan-700">
                Обновить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {!data && (
          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer ${
              isDragging ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".xml,.txt" onChange={handleInputChange} className="hidden" />
            <Upload className="w-16 h-16 mx-auto mb-4 text-slate-500" />
            <p className="text-xl font-medium text-slate-300 mb-2">Перетащите XML файл сюда</p>
            <p className="text-slate-500">или нажмите для выбора файла</p>
            <p className="text-sm text-slate-600 mt-4">Поддерживаемые форматы: .xml, .txt</p>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <div className="mb-6 text-center">
            <p className="text-lg md:text-xl text-slate-200">
              Пройдено с <span className="text-cyan-400 font-semibold">{formatDateShort(data.dateFrom)}</span> по{' '}
              <span className="text-cyan-400 font-semibold">{formatDateShort(data.dateTo)}</span> —{' '}
              <span className="text-emerald-400 font-bold text-2xl">{data.totalDistance} км</span> за{' '}
              <span className="text-amber-400 font-semibold">{data.totalRuns}</span> тренировок со средней скоростью{' '}
              <span className="text-purple-400 font-bold text-xl">{data.avgSpeed} км/ч</span>
            </p>
          </div>
        )}

        {data && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-cyan-400" />
              <span className="text-slate-300">{fileName}</span>
              <span className="text-slate-500">({data.totalRuns} записей)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={importInputRef} type="file" accept=".xml,.txt" onChange={handleImportChange} className="hidden" />
              <Button variant="outline" onClick={() => importInputRef.current?.click()} className="border-slate-600 hover:bg-slate-700">
                <Upload className="w-4 h-4 mr-2" /> Импорт XML
              </Button>

              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-slate-600 hover:bg-slate-700">
                    <Plus className="w-4 h-4 mr-2" /> Добавить
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 border-slate-700 text-white">
                  <DialogHeader>
                    <DialogTitle>Новая тренировка</DialogTitle>
                    <DialogDescription className="text-slate-400">
                      Введите данные тренировки. Формат даты: DD.MM.YYYY, времени: HH:MM
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="date" className="text-slate-300">Дата</Label>
                      <Input id="date" placeholder="14.02.2026" value={newWorkout.date} onChange={(e) => setNewWorkout({ ...newWorkout, date: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time" className="text-slate-300">Время</Label>
                      <Input id="time" placeholder="12:28" value={newWorkout.time} onChange={(e) => setNewWorkout({ ...newWorkout, time: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="km" className="text-slate-300">Расстояние (км)</Label>
                      <Input id="km" type="number" step="1" placeholder="10" value={newWorkout.km} onChange={(e) => setNewWorkout({ ...newWorkout, km: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="h" className="text-slate-300">Часы</Label>
                      <Input id="h" type="number" placeholder="1" value={newWorkout.h} onChange={(e) => setNewWorkout({ ...newWorkout, h: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="m" className="text-slate-300">Минуты</Label>
                      <Input id="m" type="number" placeholder="30" value={newWorkout.m} onChange={(e) => setNewWorkout({ ...newWorkout, m: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="drop" className="text-slate-300">Температура (°C)</Label>
                      <Input id="drop" type="number" step="1" placeholder="-5" value={newWorkout.drop} onChange={(e) => setNewWorkout({ ...newWorkout, drop: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hr" className="text-slate-300">Пульс (уд/мин)</Label>
                      <Input id="hr" type="number" placeholder="135" value={newWorkout.hr} onChange={(e) => setNewWorkout({ ...newWorkout, hr: e.target.value })} className="bg-slate-700 border-slate-600" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="border-slate-600">Отмена</Button>
                    <Button onClick={addWorkout} className="bg-cyan-600 hover:bg-cyan-700">Добавить</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button variant="outline" onClick={exportToXML} className="border-slate-600 hover:bg-slate-700">
                <Download className="w-4 h-4 mr-2" /> Экспорт XML
              </Button>

              <Button variant="outline" onClick={clearData} className="border-slate-600 hover:bg-slate-700">
                Очистить
              </Button>
            </div>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur mb-6">
            <CardHeader>
              <CardTitle className="text-white">Показатели тренировок</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 60, left: 20, bottom: 70 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="shortDate" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} label={{ value: 'Км / Км/ч', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                    <YAxis yAxisId="temp" orientation="right" stroke="#60a5fa" tick={{ fill: '#60a5fa' }} label={{ value: '°C', angle: 90, position: 'insideRight', fill: '#60a5fa' }} />
                    <YAxis yAxisId="hr" orientation="right" offset={50} stroke="#f87171" tick={{ fill: '#f87171' }} label={{ value: 'уд/мин', angle: 90, position: 'insideRight', fill: '#f87171' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="km" stroke="#22d3ee" strokeWidth={2} dot={{ fill: '#22d3ee', strokeWidth: 2, r: 3 }} name="Дистанция (км)" />
                    <Line yAxisId="left" type="monotone" dataKey="speedKmh" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }} name="Скорость (км/ч)" />
                    <Line yAxisId="temp" type="monotone" dataKey="drop" stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa', strokeWidth: 2, r: 3 }} name="Температура (°C)" connectNulls />
                    <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="#f87171" strokeWidth={2} dot={{ fill: '#f87171', strokeWidth: 2, r: 3 }} name="Пульс (уд/мин)" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {data && data.rows.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur mb-6">
            <CardHeader>
              <CardTitle className="text-white">Детализация тренировок</CardTitle>
              <CardDescription className="text-slate-400">
                Нажмите на дату для загрузки GPX трека.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-2 text-slate-400 font-medium">#</th>
                      <th className="text-left py-3 px-2 text-slate-400 font-medium">Дата</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Время</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Дист. (км)</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Часы</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Мин.</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Скор. (км/ч)</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Темп. (°C)</th>
                      <th className="text-right py-3 px-2 text-slate-400 font-medium">Пульс (уд/м)</th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium">GPX</th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, idx) => (
                      <tr key={row.id} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${editingId === row.id ? 'bg-slate-700/50' : ''}`}>
                        <td className="py-2 px-2 text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-2">
                          {editingId === row.id ? (
                            <Input type="text" value={editValues.date || ''} onChange={(e) => setEditValues({ ...editValues, date: e.target.value })} className="w-28 bg-slate-700 border-slate-600 h-8 text-sm" />
                          ) : (
                            <button onClick={() => handleDateClick(row.id)} className={`underline cursor-pointer ${row.gpxData ? 'text-emerald-400 hover:text-emerald-300' : 'text-cyan-400 hover:text-cyan-300'}`}>
                              {row.date}
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                           {editingId === row.id ? (
                             <Input type="text" placeholder="12:28" value={editValues.time || ''} onChange={(e) => setEditValues({ ...editValues, time: e.target.value })} className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                           ) : (
                             <span className="text-slate-300">{row.time || '—'}</span>
                           )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input type="number" step="1" value={editValues.km || ''} onChange={(e) => setEditValues({ ...editValues, km: parseInt(e.target.value) || 0 })} className="w-20 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                          ) : (
                            <span className="text-cyan-400">{row.km}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input type="number" value={editValues.h || ''} onChange={(e) => setEditValues({ ...editValues, h: parseInt(e.target.value) || 0 })} className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                          ) : (
                            <span className="text-slate-300">{row.h}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input type="number" value={editValues.m || ''} onChange={(e) => setEditValues({ ...editValues, m: parseInt(e.target.value) || 0 })} className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                          ) : (
                            <span className="text-slate-300">{row.m}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right"><span className="text-amber-400">{row.speedKmh}</span></td>
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input type="number" step="1" value={editValues.drop ?? ''} onChange={(e) => setEditValues({ ...editValues, drop: e.target.value ? parseInt(e.target.value) : null })} placeholder="—" className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                          ) : (
                            <span className="text-blue-400">{row.drop !== null ? row.drop : '—'}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input type="number" value={editValues.hr ?? ''} onChange={(e) => setEditValues({ ...editValues, hr: e.target.value ? parseInt(e.target.value) : null })} placeholder="—" className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto" />
                          ) : (
                            <span className="text-red-400">{row.hr !== null ? row.hr : '—'}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {row.gpxData ? <span className="text-emerald-400 text-xs">✓</span> : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-center gap-1">
                            {editingId === row.id ? (
                              <>
                                <Button size="sm" variant="ghost" onClick={saveEditing} className="h-7 w-7 p-0 text-green-400 hover:text-green-300"><Check className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" onClick={cancelEditing} className="h-7 w-7 p-0 text-slate-400 hover:text-slate-300"><X className="h-4 w-4" /></Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => startEditing(row)} className="h-7 w-7 p-0 text-slate-400 hover:text-cyan-400"><Edit2 className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteRow(row.id)} className="h-7 w-7 p-0 text-slate-400 hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {data && data.rows.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <MapIcon className="w-5 h-5" />
                Трек тренировки
              </CardTitle>
              <CardDescription className="text-slate-400">
                {selectedRow
                  ? `Запись: ${selectedRow.date} ${selectedRow.time ? `(${selectedRow.time})` : ''}${selectedGpxData ? ` | Расстояние: ${(selectedGpxData.totalDistance / 1000).toFixed(1)} км` : ''}`
                  : 'Нажмите на дату в таблице для загрузки GPX файла'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TrackMap gpxData={selectedGpxData} highlightedPointIndex={highlightedPointIndex} />

              {selectedGpxData && gpxChartData.length > 0 && (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={gpxChartData}
                      margin={{ top: 5, right: 60, left: 20, bottom: 5 }}
                      onMouseMove={(e) => {
                        if (e && e.activePayload && e.activePayload.length) {
                           setHighlightedPointIndex(e.activePayload[0].payload.originalIndex)
                        }
                      }}
                      onMouseLeave={() => setHighlightedPointIndex(null)}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="distance"
                        type="number"
                        domain={[0, 'dataMax']}
                        ticks={gpxChartTicks}
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        label={{ value: 'Расстояние (км)', position: 'insideBottom', offset: -5, fill: '#94a3b8' }}
                      />
                      <YAxis
                        yAxisId="speed"
                        stroke="#f59e0b"
                        tick={{ fill: '#f59e0b' }}
                        label={{ value: 'км/ч', angle: -90, position: 'insideLeft', fill: '#f59e0b' }}
                      />
                      <YAxis
                        yAxisId="hr"
                        orientation="right"
                        stroke="#60a5fa"
                        tick={{ fill: '#60a5fa' }}
                        label={{ value: 'уд/мин', angle: 90, position: 'insideRight', fill: '#60a5fa' }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        labelStyle={{ color: '#f1f5f9' }}
                        formatter={(value: number | null, name: string) => {
                          if (value === null) return ['—', name]
                          if (name === 'speed') return [`${value} км/ч`, 'Скорость']
                          if (name === 'hr') return [`${value} уд/мин`, 'ЧСС']
                          return [value, name]
                        }}
                        labelFormatter={(label) => `${label} км`}
                      />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      {/* Гладкие кривые Безье (monotone) + прореженные данные = идеально гладкий график */}
                      <Line
                        yAxisId="speed"
                        type="monotone"
                        dataKey="speed"
                        stroke="#f59e0b"
                        strokeWidth={3}
                        dot={false}
                        name="Скорость (км/ч)"
                        connectNulls
                      />
                      <Line
                        yAxisId="hr"
                        type="monotone"
                        dataKey="hr"
                        stroke="#60a5fa"
                        strokeWidth={3}
                        dot={false}
                        name="ЧСС (уд/мин)"
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}