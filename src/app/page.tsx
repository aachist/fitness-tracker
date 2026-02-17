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
  Activity,
  Route,
  TrendingUp,
  BarChart3,
  FileText,
  Plus,
  Download,
  Trash2,
  Edit2,
  Check,
  X,
  Thermometer,
  Heart,
} from 'lucide-react'

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
}

interface ParsedData {
  rows: TrackRow[]
  totalDistance: number
  totalTime: number
  avgSpeed: number
  totalRuns: number
  avgHr: number | null
  avgTemp: number | null
}

// Генератор уникальных ID
const generateId = () => Math.random().toString(36).substring(2, 15)

// Парсинг даты из строки DD.MM.YYYY
const parseDate = (dateStr: string): Date => {
  const [day, month, year] = dateStr.split('.').map(Number)
  return new Date(year, month - 1, day)
}

// Форматирование даты для отображения
const formatDate = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

// Сортировка строк по дате
const sortByDate = (rows: TrackRow[]): TrackRow[] => {
  return [...rows].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime())
}

export default function Home() {
  const [data, setData] = useState<ParsedData | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Состояния для редактирования
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<TrackRow>>({})

  // Состояния для добавления тренировки
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newWorkout, setNewWorkout] = useState({
    date: '',
    km: '',
    h: '',
    m: '',
    drop: '',
    hr: '',
  })

  // Пересчёт статистики
  const recalculateStats = useCallback((rows: TrackRow[]): ParsedData => {
    const totalDistance = rows.reduce((sum, r) => sum + r.km, 0)
    const totalTime = rows.reduce((sum, r) => sum + r.totalMinutes, 0)
    const avgSpeed = totalTime > 0 ? totalDistance / (totalTime / 60) : 0

    const hrValues = rows.filter(r => r.hr !== null).map(r => r.hr as number)
    const dropValues = rows.filter(r => r.drop !== null).map(r => r.drop as number)

    return {
      rows,
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalTime,
      avgSpeed: Math.round(avgSpeed * 100) / 100,
      totalRuns: rows.length,
      avgHr: hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
      avgTemp: dropValues.length > 0 ? Math.round(dropValues.reduce((a, b) => a + b, 0) / dropValues.length * 10) / 10 : null,
    }
  }, [])

  // Парсинг XML
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
        km,
        h,
        m,
        drop: dropAttr !== null ? parseFloat(dropAttr) : null,
        hr: hrAttr !== null ? parseInt(hrAttr) : null,
        totalMinutes,
        speedKmh: Math.round(speedKmh * 100) / 100,
      })
    })

    return sortByDate(trackRows)
  }, [])

  // Первичная загрузка файла
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

  // Импорт дополнительного файла
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

  // Редактирование строки
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
            km,
            h,
            m,
            totalMinutes,
            speedKmh: Math.round(speedKmh * 100) / 100,
          } as TrackRow
        }
        return row
      })
      return recalculateStats(updatedRows)
    })
    setEditingId(null)
    setEditValues({})
  }

  // Удаление строки
  const deleteRow = (id: string) => {
    setData(prev => {
      if (!prev) return prev
      const filteredRows = prev.rows.filter(row => row.id !== id)
      return recalculateStats(filteredRows)
    })
  }

  // Добавление новой тренировки
  const addWorkout = () => {
    const [day, month, year] = newWorkout.date.split('.').map(Number)
    const date = newWorkout.date

    const newRow: TrackRow = {
      id: generateId(),
      date,
      km: parseFloat(newWorkout.km) || 0,
      h: parseInt(newWorkout.h) || 0,
      m: parseInt(newWorkout.m) || 0,
      drop: newWorkout.drop !== '' ? parseFloat(newWorkout.drop) : null,
      hr: newWorkout.hr !== '' ? parseInt(newWorkout.hr) : null,
      totalMinutes: (parseInt(newWorkout.h) || 0) * 60 + (parseInt(newWorkout.m) || 0),
      speedKmh: 0,
    }

    newRow.speedKmh = newRow.totalMinutes > 0
      ? Math.round((newRow.km / (newRow.totalMinutes / 60)) * 100) / 100
      : 0

    setData(prev => {
      if (!prev) return recalculateStats([newRow])
      const combinedRows = sortByDate([...prev.rows, newRow])
      return recalculateStats(combinedRows)
    })

    setNewWorkout({ date: '', km: '', h: '', m: '', drop: '', hr: '' })
    setIsAddDialogOpen(false)
  }

  // Экспорт в XML
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

  const formatTime = (minutes: number): string => {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `${h}ч ${m}мин`
  }

  // Подготовка данных для графика
  const chartData = data?.rows.map((row) => ({
    date: row.date,
    shortDate: parseDate(row.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    km: row.km,
    speedKmh: row.speedKmh,
    drop: row.drop,
    hr: row.hr,
  })) || []

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">
            Анализатор тренировок
          </h1>
          <p className="text-slate-400 text-lg">Загрузите XML файл с данными тренировок для визуализации прогресса</p>
        </div>

        {/* File Upload Area */}
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

        {/* Toolbar */}
        {data && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-cyan-400" />
              <span className="text-slate-300">{fileName}</span>
              <span className="text-slate-500">({data.totalRuns} записей)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Импорт */}
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

              {/* Добавить тренировку */}
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
                        step="0.01"
                        placeholder="10.5"
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
                        step="0.1"
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

              {/* Экспорт */}
              <Button
                variant="outline"
                onClick={exportToXML}
                className="border-slate-600 hover:bg-slate-700"
              >
                <Download className="w-4 h-4 mr-2" />
                Экспорт XML
              </Button>

              {/* Сброс */}
              <Button
                variant="outline"
                onClick={() => {
                  setData(null)
                  setFileName('')
                }}
                className="border-slate-600 hover:bg-slate-700"
              >
                Новый файл
              </Button>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Расстояние</CardTitle>
                <Route className="h-4 w-4 text-cyan-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{data.totalDistance} <span className="text-sm text-slate-400">км</span></div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Время</CardTitle>
                <Activity className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{formatTime(data.totalTime)}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Ср. скорость</CardTitle>
                <TrendingUp className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{data.avgSpeed} <span className="text-sm text-slate-400">км/ч</span></div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Тренировок</CardTitle>
                <BarChart3 className="h-4 w-4 text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{data.totalRuns}</div>
              </CardContent>
            </Card>
            {data.avgTemp !== null && (
              <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Ср. температура</CardTitle>
                  <Thermometer className="h-4 w-4 text-blue-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">{data.avgTemp} <span className="text-sm text-slate-400">°C</span></div>
                </CardContent>
              </Card>
            )}
            {data.avgHr !== null && (
              <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-400">Ср. пульс</CardTitle>
                  <Heart className="h-4 w-4 text-red-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">{data.avgHr} <span className="text-sm text-slate-400">уд/мин</span></div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Chart */}
        {data && (
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
                    {/* Ось Y для расстояния и скорости */}
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
                    {/* Ось Y для температуры */}
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
                    {/* Ось Y для пульса */}
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
                    {/* Дистанция */}
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
                    {/* Скорость */}
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
                    {/* Температура */}
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
                    {/* Пульс */}
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

        {/* Data Table */}
        {data && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-white">Детализация тренировок</CardTitle>
              <CardDescription className="text-slate-400">
                Двойной клик на ячейке для редактирования. Размерность указана в заголовках столбцов.
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

                        {/* Дата */}
                        <td className="py-2 px-2">
                          {editingId === row.id ? (
                            <Input
                              type="text"
                              value={editValues.date || ''}
                              onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                              className="w-28 bg-slate-700 border-slate-600 h-8 text-sm"
                            />
                          ) : (
                            <span className="text-white">{row.date}</span>
                          )}
                        </td>

                        {/* Дистанция */}
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editValues.km || ''}
                              onChange={(e) => setEditValues({ ...editValues, km: parseFloat(e.target.value) || 0 })}
                              className="w-20 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-cyan-400">{row.km}</span>
                          )}
                        </td>

                        {/* Часы */}
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

                        {/* Минуты */}
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

                        {/* Скорость */}
                        <td className="py-2 px-2 text-right">
                          <span className="text-amber-400">{row.speedKmh}</span>
                        </td>

                        {/* Температура */}
                        <td className="py-2 px-2 text-right">
                          {editingId === row.id ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editValues.drop ?? ''}
                              onChange={(e) => setEditValues({ ...editValues, drop: e.target.value ? parseFloat(e.target.value) : null })}
                              placeholder="—"
                              className="w-16 bg-slate-700 border-slate-600 h-8 text-sm text-right ml-auto"
                            />
                          ) : (
                            <span className="text-blue-400">{row.drop !== null ? row.drop : '—'}</span>
                          )}
                        </td>

                        {/* Пульс */}
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

                        {/* Действия */}
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

        {/* Footer */}
        <div className="mt-12 text-center text-slate-500 text-sm">
          <p>Анализатор тренировок • XML визуализация данных</p>
        </div>
      </div>
    </div>
  )
}
