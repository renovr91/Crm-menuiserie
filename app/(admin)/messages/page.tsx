'use client'

import { useState } from 'react'

interface ClassificationResult {
  cas: string
  produit?: string
  quantite?: number
  dimensions?: string
  couleur?: string
  options?: string[]
  localisation?: string
  has_attachment: boolean
  has_phone: boolean
  response: string
}

export default function MessagesPage() {
  const [titreAnnonce, setTitreAnnonce] = useState('')
  const [messageClient, setMessageClient] = useState('')
  const [hasAttachment, setHasAttachment] = useState(false)
  const [result, setResult] = useState<ClassificationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleClassify() {
    if (!messageClient.trim()) return
    setLoading(true)
    setCopied(false)
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre_annonce: titreAnnonce, message_client: messageClient, has_attachment: hasAttachment }),
      })
      if (!res.ok) throw new Error('Erreur')
      const data = await res.json()
      setResult(data)
    } catch { alert('Erreur lors de la classification') }
    finally { setLoading(false) }
  }

  function handleCopy() {
    if (result?.response) {
      navigator.clipboard.writeText(result.response)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-8">Messages Leboncoin</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Message reçu</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titre de l&apos;annonce</label>
                <input type="text" value={titreAnnonce} onChange={(e) => setTitreAnnonce(e.target.value)} placeholder="Ex: Volet roulant ALU electrique" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message du client *</label>
                <textarea value={messageClient} onChange={(e) => setMessageClient(e.target.value)} rows={6} placeholder="Collez le message du client ici..." className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasAttachment} onChange={(e) => setHasAttachment(e.target.checked)} className="rounded" />
                Le message contient une pièce jointe
              </label>
              <button onClick={handleClassify} disabled={loading || !messageClient.trim()} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {loading ? 'Analyse en cours...' : 'Analyser le message'}
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {result ? (
            <>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold mb-4">Analyse</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Cas</span><span className="font-mono font-bold text-blue-600">{result.cas}</span></div>
                  {result.produit && <div className="flex justify-between"><span className="text-gray-500">Produit</span><span>{result.produit}</span></div>}
                  {result.quantite && <div className="flex justify-between"><span className="text-gray-500">Quantité</span><span>{result.quantite}</span></div>}
                  {result.dimensions && <div className="flex justify-between"><span className="text-gray-500">Dimensions</span><span>{result.dimensions}</span></div>}
                  {result.couleur && <div className="flex justify-between"><span className="text-gray-500">Couleur</span><span>{result.couleur}</span></div>}
                  {result.localisation && <div className="flex justify-between"><span className="text-gray-500">Localisation</span><span>{result.localisation}</span></div>}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold mb-4">Réponse suggérée</h2>
                <div className="bg-gray-50 rounded-lg p-4 text-sm whitespace-pre-wrap mb-4">{result.response}</div>
                <button onClick={handleCopy} className={`w-full py-3 rounded-lg font-medium transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
                  {copied ? 'Copié !' : 'Copier la réponse'}
                </button>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
              <p className="text-gray-400 text-sm">Collez un message client et cliquez &quot;Analyser&quot; pour voir la réponse suggérée</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
