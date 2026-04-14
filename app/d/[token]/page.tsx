'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import SignatureCanvas from 'react-signature-canvas'

interface DevisData {
  id: string
  reference: string
  status: string
  montant_ht: number
  tva: number
  montant_ttc: number
  pdf_url: string
  notes: string
  signed_at: string | null
  created_at: string
  client_nom: string
}

export default function DevisClientPage() {
  const { token } = useParams()
  const [devis, setDevis] = useState<DevisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showSignature, setShowSignature] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signed, setSigned] = useState(false)
  const sigCanvas = useRef<SignatureCanvas | null>(null)

  useEffect(() => {
    fetch(`/api/d/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error('Lien invalide ou expiré')
        return res.json()
      })
      .then((data) => {
        setDevis(data)
        if (data.status === 'signe') setSigned(true)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSign() {
    if (!sigCanvas.current || sigCanvas.current.isEmpty() || !devis) {
      alert('Veuillez dessiner votre signature')
      return
    }
    setSubmitting(true)
    try {
      const signatureData = sigCanvas.current.toDataURL()
      const res = await fetch('/api/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devis_id: devis.id, signature_data: signatureData })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Erreur lors de la signature')
      }
      setSigned(true)
      setShowSignature(false)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-gray-300 border-t-black rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Chargement du devis...</p>
        </div>
      </div>
    )
  }

  if (error || !devis) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-2xl shadow-sm border text-center max-w-md">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-gray-500">{error || 'Ce devis n\'existe pas ou le lien a expiré.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-black text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">RENOV-R 91</h1>
            <p className="text-gray-400 text-sm">Votre devis</p>
          </div>
          <div className="text-right">
            <p className="font-semibold">{devis.reference}</p>
            <p className="text-gray-400 text-sm">
              {new Date(devis.created_at).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'long', year: 'numeric'
              })}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Bandeau signé */}
        {signed && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-2xl">&#10003;</span>
            <div>
              <p className="font-semibold text-green-800">Devis signé</p>
              <p className="text-green-600 text-sm">Merci ! Votre accord a bien été enregistré.</p>
            </div>
          </div>
        )}

        {/* PDF embed */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <iframe
            src={`${devis.pdf_url}#toolbar=1&navpanes=0`}
            className="w-full border-0"
            style={{ height: '80vh', minHeight: '600px' }}
            title={`Devis ${devis.reference}`}
          />
        </div>

        {/* Montant récap */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Montant total TTC</p>
              <p className="text-3xl font-bold text-gray-900">
                {devis.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
            <div className="text-right text-sm text-gray-500">
              <p>HT : {devis.montant_ht.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</p>
              <p>TVA ({devis.tva}%) : {(devis.montant_ttc - devis.montant_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</p>
            </div>
          </div>
        </div>

        {/* Signature */}
        {!signed && (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            {!showSignature ? (
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  En signant ce devis, vous acceptez les conditions et les tarifs proposés.
                </p>
                <button
                  onClick={() => setShowSignature(true)}
                  className="bg-black text-white px-8 py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors text-lg w-full sm:w-auto"
                >
                  Accepter et signer ce devis
                </button>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-gray-900 mb-3">
                  Dessinez votre signature ci-dessous :
                </p>
                <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 mb-4">
                  <SignatureCanvas
                    ref={sigCanvas}
                    canvasProps={{
                      className: 'w-full rounded-xl',
                      style: { width: '100%', height: '180px', touchAction: 'none' }
                    }}
                    penColor="black"
                    backgroundColor="rgb(249, 250, 251)"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => sigCanvas.current?.clear()}
                    className="px-6 py-3 border border-gray-300 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                  >
                    Effacer
                  </button>
                  <button
                    onClick={handleSign}
                    disabled={submitting}
                    className="flex-1 bg-green-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Signature en cours...' : 'Valider ma signature'}
                  </button>
                  <button
                    onClick={() => setShowSignature(false)}
                    className="px-6 py-3 text-gray-500 text-sm hover:text-gray-700"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="text-center text-gray-400 text-xs py-4">
          <p>Renov-R 91 — contact@renov-r.com — 01 79 72 52 25</p>
        </footer>
      </div>
    </div>
  )
}
