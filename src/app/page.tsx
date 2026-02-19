'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
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

// Динамический импорт Leaflet (только на клиенте)
import dynamic from 'next/dynamic'

// Типы для GPX данных
interface GpxPoint {
  lat: number
  lon: number
  ele: number | null
  time: string | null
  speed: number | null // км/ч
  distance: number // метры от начала
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
  km: number
  h: number
  m: number
  drop: number | null
  hr: number | null
  totalMinutes: number
  speedKmh: number
  gpxData: GpxData | null
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

const STORAGE_KEY = 'fitness-tracker-data-v2'
const GPX_STORAGE_KEY = 'fitness-tracker-gpx-v2'

const generateId = () => Math.random().toString(36).substring(2, 15)

const parseDate = (dateStr: string): Date => {
  const [day, month, year] = dateStr.split('.').map(Number)
  return new Date(year, month - 1, day)
}

const formatDateShort = (dateStr: string): string => {
  const [day, month, year] = dateStr.split('.')
  return `${day}.${month}.${year?.slice(-2)}`
}

const sortByDate = (rows: TrackRow[]): TrackRow[] => {
  return [...rows].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime())
}

// Расстояние между двумя точками (формула Гаверсинуса)
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000 // радиус Земли в метрах
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Парсинг GPX
const parseGPX = (gpxContent: string, date: string): GpxData | null => {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(gpxContent, 'text/xml')
    
    const trkpts = xmlDoc.querySelectorAll('trkpt')
    if (trkpts.length === 0) return null

    const points: GpxPoint[] = []
    let totalDistance = 0
    let prevPoint: { lat: number; lon: number; time: Date | null } | null = null

    trkpts.forEach((pt, index) => {
      const lat = parseFloat(pt.getAttribute('lat') || '0')
      const lon = parseFloat(pt.getAttribute('lon') || '0')
      const eleElement = pt.querySelector('ele')
      const timeElement = pt.querySelector('time')
      
      const ele = eleElement ? parseFloat(eleElement.textContent || '0') : null
      const timeStr = timeElement ? timeElement.textContent : null
      const time = timeStr ? new Date(timeStr) : null

      let distance = 0
      let speed: number | null = null

      if (prevPoint && prevPoint.time && time) {
        distance = haversineDistance(prevPoint.lat, prevPoint.lon, lat, lon)
        const timeDiff = (time.getTime() - prevPoint.time.getTime()) / 1000 / 3600 // часы
        if (timeDiff > 0) {
          speed = (distance / 1000) / timeDiff // км/ч
        }
      }

      totalDistance += distance

      points.push({
        lat,
        lon,
        ele,
        time: timeStr,
        speed: speed ? Math.round(speed * 10) / 10 : null,
        distance: Math.round(totalDistance),
      })

      prevPoint = { lat, lon, time }
    })

    // Вычисляем общее время и среднюю скорость
    const firstTime = points[0]?.time ? new Date(points[0].time) : null
    const lastTime = points[points.length - 1]?.time ? new Date(points[points.length - 1].time) : null
    const totalTime = firstTime && lastTime ? (lastTime.getTime() - firstTime.getTime()) / 1000 / 60 : 0
    const avgSpeed = totalTime > 0 ? (totalDistance / 1000) / (totalTime / 60) : 0

    return {
      date,
      points,
      totalDistance: Math.round(totalDistance),
      totalTime: Math.round(totalTime),
      avgSpeed: Math.round(avgSpeed * 10) / 10,
    }
  } catch (error) {
    console.error('Error parsing GPX:', error)
    return null
  }
}

// Компонент карты (динамический)
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false })
const useMap = dynamic(() => import('react-leaflet').then(mod => mod.useMap), { ssr: false })

// Компонент для изменения вида карты
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const mapRef = useRef<any>(null)
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('react-leaflet').then(({ useMap }) => {
        const map = mapRef.current
        if (map) {
          map.setView(center, zoom)
        }
      })
    }
  }, [center, zoom])
  
  return null
}

// Компонент карты
function TrackMap({ gpxData }: { gpxData: GpxData | null }) {
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
          {mounted ? 'Загрузите GPX файл, нажав на дату в таблице' : 'Загрузка карты...'}
        </p>
      </div>
    )
  }

  const points = gpxData.points
  const center: [number, number] = [points[0].lat, points[0].lon]
  const path: [number, number][] = points.map(p => [p.lat, p.lon])

  return (
    <div className="h-[400px] rounded-lg overflow-hidden border border-slate-600">
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        {/* Спутниковый слой ESRI (бесплатный) */}
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {/* Дополнительный слой с названиями */}
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
          </>
        )}
      </MapContainer>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<ParsedData | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const savedData = localStorage.getItem(STORAGE_KEY)
      if (savedData) {
        return JSON.parse(savedData)
      }
    } catch (error) {
      console.error('Error loading from localStorage:', error)
    }
    return null
  })
  const [fileName, setFileName] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try {
      const savedData = localStorage.getItem(STORAGE_KEY)
      return savedData ? 'сохранённые данные' : ''
    } catch {
      return ''
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const gpxInputRef = useRef<HTMLInputElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<TrackRow>>({})

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newWorkout, setNewWorkout] = useState({
    date: '',
    km: '',
    h: '',
    m: '',
    drop: '',
    hr: '',
  })

  // Состояние для GPX
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedGpxData, setSelectedGpxData] = useState<GpxData | null>(null)
  const [gpxDateToLoad, setGpxDateToLoad] = useState<string | null>(null)
  const [showGpxDialog, setShowGpxDialog] = useState(false)

  useEffect(() => {
    if (data && data.rows.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch (error) {
        console.error('Error saving to localStorage:', error)
      }
    }
  }, [data])

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

  const parseXML = useCallback((xmlContent: string): TrackRow[] => {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml')
    const rows = xmlDoc.querySelectorAll('row')

    const trackRows: TrackRow[] = []

    rows.forEach((row) => {
      const date = row.getAttribute('date') || ''
      const km = parseFloat(row.getAttribute('km') || '0')
      const h = parseInt(row.getAttribute('h') || '0')
      const m = parseInt(row.getAttribute('m') || '0')
      const dropAttr = row.getAttribute('drop')
      const hrAttr = row.getAttribute('hr')

      const totalMinutes = h * 60 + m
      const speedKmh = totalMinutes > 0 ? (km / (totalMinutes / 60)) : 0

      trackRows.push({
        id: generateId(),
        date,
        km: Math.round(km),
        h,
        m,
        drop: dropAttr !== null && dropAttr !== '' ? Math.round(parseFloat(dropAttr)) : null,
        hr: hrAttr !== null && hrAttr !== '' ? parseInt(hrAttr) : null,
        totalMinutes,
        speedKmh: Math.round(speedKmh),
        gpxData: null,
      })
    })

    return sortByDate(trackRows)
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const rows = parseXML(content)
        setData(recalculateStats(rows))
      }
      reader.readAsText(file)
    },
    [parseXML, recalculateStats]
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        handleFile(file)
      }
    },
    [handleFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleFile(file)
      }
    },
    [handleFile]
  )

  const handleImportChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleImportFile(file)
      }
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    },
    [handleImportFile]
  )

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
          return {
            ...row,
            ...editValues,
            km: Math.round(km),
            h,
            m,
            totalMinutes,
            speedKmh: Math.round(speedKmh),
            drop: editValues.drop !== null ? Math.round(editValues.drop) : null,
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

    const newRow: TrackRow = {
      id: generateId(),
      date,
      km: Math.round(parseFloat(newWorkout.km) || 0),
      h: parseInt(newWorkout.h) || 0,
      m: parseInt(newWorkout.m) || 0,
      drop: newWorkout.drop !== '' ? Math.round(parseFloat(newWorkout.drop)) : null,
      hr: newWorkout.hr !== '' ? parseInt(newWorkout.hr) : null,
      totalMinutes: (parseInt(newWorkout.h) || 0) * 60 + (parseInt(newWorkout.m) || 0),
      speedKmh: 0,
      gpxData: null,
    }

    newRow.speedKmh = newRow.totalMinutes > 0
      ? Math.round(newRow.km / (newRow.totalMinutes / 60))
      : 0

    setData(prev => {
      if (!prev) return recalculateStats([newRow])
      const combinedRows = sortByDate([...prev.rows, newRow])
      return recalculateStats(combinedRows)
    })

    setNewWorkout({ date: '', km: '', h: '', m: '', drop: '', hr: '' })
    setIsAddDialogOpen(false)
  }

  const exportToXML = () => {
    if (!data) return

    let xmlContent = `<?xml version='1.0' encoding='utf-8'?>\n<tracks>`

    data.rows.forEach(row => {
      const dropAttr = row.drop !== null ? ` drop="${row.drop}"` : ''
      const hrAttr = row.hr !== null ? ` hr="${row.hr}"` : ''
      xmlContent += `<row date="${row.date}" km="${row.km}" h="${row.h}" m="${row.m}"${dropAttr}${hrAttr} />`
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
    setFileName('')
    setSelectedGpxData(null)
    setSelectedDate(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  // Обработка клика по дате
  const handleDateClick = (date: string) => {
    const existingRow = data?.rows.find(r => r.date === date)
    
    if (existingRow?.gpxData) {
      // GPX уже есть для этой даты
      setGpxDateToLoad(date)
      setShowGpxDialog(true)
    } else {
      // Запрос нового GPX
      setSelectedDate(date)
      setSelectedGpxData(null)
      setTimeout(() => {
        gpxInputRef.current?.click()
      }, 100)
    }
  }

  // Обработка GPX файла
  const handleGpxLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedDate) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      const gpxData = parseGPX(content, selectedDate)
      
      if (gpxData) {
        setSelectedGpxData(gpxData)
        
        // Сохраняем GPX данные в строку
        setData(prev => {
          if (!prev) return prev
          const updatedRows = prev.rows.map(row => {
            if (row.date === selectedDate) {
              return { ...row, gpxData }
            }
            return row
          })
          return recalculateStats(updatedRows)
        })
      }
    }
    reader.readAsText(file)
    
    if (gpxInputRef.current) {
      gpxInputRef.current.value = ''
    }
  }

  // Обновление GPX
  const handleUpdateGpx = () => {
    setShowGpxDialog(false)
    setSelectedDate(gpxDateToLoad)
    setSelectedGpxData(null)
    setTimeout(() => {
      gpxInputRef.current?.click()
    }, 100)
  }

  // Использовать существующий GPX
  const handleUseExistingGpx = () => {
    const existingRow = data?.rows.find(r => r.date === gpxDateToLoad)
    if (existingRow?.gpxData) {
      setSelectedDate(gpxDateToLoad)
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

  // Данные для графика GPX
  const gpxChartData = selectedGpxData?.points
    .filter(p => p.speed !== null || p.ele !== null)
    .map((p, idx) => ({
      distance: Math.round(p.distance / 100) / 10, // км
      speed: p.speed,
      ele: p.ele,
    })) || []

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">
            Анализатор тренировок
          </h1>
        </div>

        {/* Скрытый input для GPX */}
        <input
          ref={gpxInputRef}
          type="file"
          accept=".gpx"
          onChange={handleGpxLoad}
          className="hidden"
        />

        {/* Диалог обновления GPX */}
        <Dialog open={showGpxDialog} onOpenChange={setShowGpxDialog}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white">
            <DialogHeader>
              <DialogTitle>GPX файл уже загружен</DialogTitle>
              <DialogDescription className="text-slate-400">
                Для даты {gpxDateToLoad} уже есть GPX данные. Обновить?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleUseExistingGpx} className="border-slate-600">
                Использовать старые
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
              isDragging
                ? 'border-cyan-400 bg-cyan-400/10'
                : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.txt"
              onChange={handleInputChange}
              className="hidden"
            />
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
              <input
                ref={importInputRef}
                type="file"
                accept=".xml,.txt"
                onChange={handleImportChange}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => importInputRef.current?.click()}
                className="border-slate-600 hover:bg-slate-700"
              >
                <Upload className="w-4 h-4 mr-2" />
                Импорт XML
              </Button>

              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-slate-600 hover:bg-slate-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Добавить
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 border-slate-700 text-white">
                  <DialogHeader>
                    <DialogTitle>Новая тренировка</DialogTitle>
                    <DialogDescription className="text-slate-400">
                      Введите данные тренировки. Формат даты: DD.MM.YYYY
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="date" className="text-slate-300">Дата</Label>
                      <Input
                        id="date"
                        placeholder="14.02.2026"
                        value={newWorkout.date}
                        onChange={(e) => setNewWorkout({ ...newWorkout, date: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="km" className="text-slate-300">Расстояние (км)</Label>
                      <Input
                        id="km"
                        type="number"
                        step="1"
                        placeholder="10"
                        value={newWorkout.km}
                        onChange={(e) => setNewWorkout({ ...newWorkout, km: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="h" className="text-slate-300">Часы</Label>
                      <Input
                        id="h"
                        type="number"
                        placeholder="1"
                        value={newWorkout.h}
                        onChange={(e) => setNewWorkout({ ...newWorkout, h: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="m" className="text-slate-300">Минуты</Label>
                      <Input
                        id="m"
                        type="number"
                        placeholder="30"
                        value={newWorkout.m}
                        onChange={(e) => setNewWorkout({ ...newWorkout, m: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="drop" className="text-slate-300">Температура (°C)</Label>
                      <Input
                        id="drop"
                        type="number"
                        step="1"
                        placeholder="-5"
                        value={newWorkout.drop}
                        onChange={(e) => setNewWorkout({ ...newWorkout, drop: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hr" className="text-slate-300">Пульс (уд/мин)</Label>
                      <Input
                        id="hr"
                        type="number"
                        placeholder="135"
                        value={newWorkout.hr}
                        onChange={(e) => setNewWorkout({ ...newWorkout, hr: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="border-slate-600">
                      Отмена
                    </Button>
                    <Button onClick={addWorkout} className="bg-cyan-600 hover:bg-cyan-700">
                      Добавить
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                onClick={exportToXML}
                className="border-slate-600 hover:bg-slate-700"
              >
                <Download className="w-4 h-4 mr-2" />
                Экспорт XML
              </Button>

              <Button
                variant="outline"
                onClick={clearData}
                className="border-slate-600 hover:bg-slate-700"
              >
                Очистить
              </Button>
            </div>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur mb-6">
            <CardHeader>
              <CardTitle className="text-white">Показатели тренировок</CardTitle>
              <CardDescription className="text-slate-400">
                Дистанция, скорость, температура и пульс по всем тренировкам
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 60, left: 20, bottom: 70 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="shortDate"
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8' }}
                      label={{
                        value: 'Км / Км/ч',
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#94a3b8',
                      }}
                    />
                    <YAxis
                      yAxisId="temp"
                      orientation="right"
                      stroke="#60a5fa"
                      tick={{ fill: '#60a5fa' }}
                      label={{
                        value: '°C',
                        angle: 90,
                        position: 'insideRight',
                        fill: '#60a5fa',
                      }}
                    />
                    <YAxis
                      yAxisId="hr"
                      orientation="right"
                      offset={50}
                      stroke="#f87171"
                      tick={{ fill: '#f87171' }}
                      label={{
                        value: 'уд/мин',
                        angle: 90,
                        position: 'insideRight',
                        fill: '#f87171',
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#f1f5f9' }}
                      formatter={(value: number | null, name: string) => {
                        if (value === null) return ['—', name]
                        if (name === 'km') return [`${value} км`, 'Дистанция']
                        if (name === 'speedKmh') return [`${value} км/ч`, 'Скорость']
                        if (name === 'drop') return [`${value} °C`, 'Температура']
                        if (name === 'hr') return [`${value} уд/мин`, 'Пульс']
                        return [value, name]
                      }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: '20px' }}
                      formatter={(value) => {
                        if (value === 'km') return 'Дистанция (км)'
                        if (value === 'speedKmh') return 'Скорость (км/ч)'
                        if (value === 'drop') return 'Температура (°C)'
                        if (value === 'hr') return 'Пульс (уд/мин)'
                        return value
                      }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="km"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={{ fill: '#22d3ee', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#22d3ee' }}
                      name="km"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="speedKmh"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#f59e0b' }}
                      name="speedKmh"
                    />
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="drop"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{ fill: '#60a5fa', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#60a5fa' }}
                      name="drop"
                      connectNulls
                    />
                    <Line
                      yAxisId="hr"
                      type="monotone"
                      dataKey="hr"
                      stroke="#f87171"
                      strokeWidth={2}
                      dot={{ fill: '#f87171', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#f87171' }}
                      name="hr"
                      connectNulls
                    />
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
                Нажмите на дату для загрузки GPX трека. Размерность указана в заголовках столбцов.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-2 text-slate-400 font-medium">#</th>
                      <th className="text-left py-3 px-2 text-slate-400 font-medium">Дата</th>
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
                      <tr
                        key={row.id}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                          editingId === row.id ? 'bg-slate-700/50' : ''
                        }`}
                      >
                        <td className="py-2 px-2 text-slate-500">{idx + 1}</td>

                        <td className="py-2 px-2">
                          {editingId === row.id ? (
                            <Input
                              type="text"
                              value={editValues.date || ''}
                              onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                              className="w-28 bg-slate-700 border-slate-600 h-8 text-sm"
                            />
                          ) : (
                            <button
                              onClick={() => handleDateClick(row.date)}
                              className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                            >
                              {row.date}
                            </button>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              step="1"
                              value={editValues.km || ''}
                              onChange={(e) => setEditValues({ ...editValues, km: parseInt(e.target.value) || 0 })}
                              className="w-20 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-cyan-400">{row.km}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              value={editValues.h || ''}
                              onChange={(e) => setEditValues({ ...editValues, h: parseInt(e.target.value) || 0 })}
                              className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-slate-300">{row.h}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              value={editValues.m || ''}
                              onChange={(e) => setEditValues({ ...editValues, m: parseInt(e.target.value) || 0 })}
                              className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-slate-300">{row.m}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right">
                          <span className="text-amber-400">{row.speedKmh}</span>
                        </td>

                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              step="1"
                              value={editValues.drop ?? ''}
                              onChange={(e) => setEditValues({ ...editValues, drop: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder="—"
                              className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-blue-400">{row.drop !== null ? row.drop : '—'}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              value={editValues.hr ?? ''}
                              onChange={(e) => setEditValues({ ...editValues, hr: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder="—"
                              className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-red-400">{row.hr !== null ? row.hr : '—'}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-center">
                          {row.gpxData ? (
                            <span className="text-emerald-400 text-xs">✓</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        <td className="py-2 px-2">
                          <div className="flex items-center justify-center gap-1">
                            {editingId === row.id ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={saveEditing}
                                  className="h-7 w-7 p-0 text-green-400 hover:text-green-300"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEditing}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-slate-300"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => startEditing(row)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-cyan-400"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => deleteRow(row.id)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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

        {/* Карта и график GPX */}
        {data && data.rows.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <MapIcon className="w-5 h-5" />
                Трек тренировки
              </CardTitle>
              <CardDescription className="text-slate-400">
                {selectedDate 
                  ? `Дата: ${selectedDate}${selectedGpxData ? ` | Расстояние: ${(selectedGpxData.totalDistance / 1000).toFixed(1)} км` : ''}`
                  : 'Нажмите на дату в таблице для загрузки GPX файла'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TrackMap gpxData={selectedGpxData} />

              {selectedGpxData && gpxChartData.length > 0 && (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={gpxChartData}
                      margin={{ top: 5, right: 60, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="distance"
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        label={{
                          value: 'Расстояние (км)',
                          position: 'insideBottom',
                          offset: -5,
                          fill: '#94a3b8',
                        }}
                      />
                      <YAxis
                        yAxisId="speed"
                        stroke="#f59e0b"
                        tick={{ fill: '#f59e0b' }}
                        label={{
                          value: 'км/ч',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#f59e0b',
                        }}
                      />
                      <YAxis
                        yAxisId="ele"
                        orientation="right"
                        stroke="#60a5fa"
                        tick={{ fill: '#60a5fa' }}
                        label={{
                          value: 'м',
                          angle: 90,
                          position: 'insideRight',
                          fill: '#60a5fa',
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: '#f1f5f9' }}
                        formatter={(value: number | null, name: string) => {
                          if (value === null) return ['—', name]
                          if (name === 'speed') return [`${value} км/ч`, 'Скорость']
                          if (name === 'ele') return [`${value} м`, 'Высота']
                          return [value, name]
                        }}
                        labelFormatter={(label) => `${label} км`}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: '20px' }}
                        formatter={(value) => {
                          if (value === 'speed') return 'Скорость (км/ч)'
                          if (value === 'ele') return 'Высота (м)'
                          return value
                        }}
                      />
                      <Line
                        yAxisId="speed"
                        type="monotone"
                        dataKey="speed"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                        name="speed"
                        connectNulls
                      />
                      <Line
                        yAxisId="ele"
                        type="monotone"
                        dataKey="ele"
                        stroke="#60a5fa"
                        strokeWidth={2}
                        dot={false}
                        name="ele"
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="mt-12 text-center text-slate-500 text-sm">
          <p>Анализатор тренировок • XML + GPX визуализация данных</p>
        </div>
      </div>
    </div>
  )
}
