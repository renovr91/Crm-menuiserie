'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
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

type Step = 'view' | 'send_code' | 'enter_code' | 'sign'

/* ── Slide to confirm component ── */
function SlideToConfirm({ onConfirm, disabled, label }: { onConfirm: () => void; disabled: boolean; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [offsetX, setOffsetX] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const startX = useRef(0)
  const maxOffset = useRef(0)

  const handleStart = useCallback((clientX: number) => {
    if (disabled || confirmed) return
    setDragging(true)
    startX.current = clientX - offsetX
    if (trackRef.current) {
      maxOffset.current = trackRef.current.offsetWidth - 56
    }
  }, [disabled, confirmed, offsetX])

  const handleMove = useCallback((clientX: number) => {
    if (!dragging) return
    const x = Math.max(0, Math.min(clientX - startX.current, maxOffset.current))
    setOffsetX(x)
  }, [dragging])

  const handleEnd = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    if (offsetX >= maxOffset.current * 0.85) {
      setOffsetX(maxOffset.current)
      setConfirmed(true)
      onConfirm()
    } else {
      setOffsetX(0)
    }
  }, [dragging, offsetX, onConfirm])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => handleMove(e.clientX)
    const onUp = () => handleEnd()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, handleMove, handleEnd])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: TouchEvent) => handleMove(e.touches[0].clientX)
    const onUp = () => handleEnd()
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging, handleMove, handleEnd])

  const progress = maxOffset.current > 0 ? offsetX / maxOffset.current : 0

  return (
    <div
      ref={trackRef}
      className={`relative h-14 rounded-xl overflow-hidden select-none ${confirmed ? 'bg-green-600' : 'bg-gray-200'}`}
    >
      {!confirmed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-gray-400 font-medium text-sm" style={{ opacity: 1 - progress }}>
            {label}
          </span>
        </div>
      )}
      {confirmed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-semibold">&#10003; Confirmé</span>
        </div>
      )}
      {!confirmed && (
        <div
          className="absolute top-1 left-1 h-12 w-12 bg-green-600 rounded-lg flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg"
          style={{ transform: `translateX(${offsetX}px)`, transition: dragging ? 'none' : 'transform 0.3s ease' }}
          onMouseDown={(e) => handleStart(e.clientX)}
          onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}
    </div>
  )
}

/* ── Main page ── */
export default function DevisClientPage() {
  const { token } = useParams()
  const [devis, setDevis] = useState<DevisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signed, setSigned] = useState(false)

  // OTP state
  const [step, setStep] = useState<Step>('view')
  const [phoneMasked, setPhoneMasked] = useState('')
  const [code, setCode] = useState('')
  const [otpId, setOtpId] = useState('')
  const [otpError, setOtpError] = useState('')
  const [sending, setSending] = useState(false)

  // Signature state
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [slideConfirmed, setSlideConfirmed] = useState(false)
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

  async function handleSendCode() {
    setSending(true)
    setOtpError('')
    try {
      const res = await fetch(`/api/d/${token}/send-code`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPhoneMasked(data.phone_masked)
      setStep('enter_code')
    } catch (err) {
      setOtpError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function handleVerifyCode() {
    setSending(true)
    setOtpError('')
    try {
      const res = await fetch(`/api/d/${token}/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOtpId(data.otp_id)
      setStep('sign')
    } catch (err) {
      setOtpError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function handleSign() {
    if (!sigCanvas.current || sigCanvas.current.isEmpty() || !devis) {
      setOtpError('Veuillez dessiner votre signature')
      return
    }
    if (!consent) {
      setOtpError('Veuillez cocher la case de consentement')
      return
    }
    setSubmitting(true)
    setOtpError('')
    try {
      const signatureData = sigCanvas.current.toDataURL()
      const res = await fetch('/api/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devis_id: devis.id,
          signature_data: signatureData,
          otp_id: otpId
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Erreur lors de la signature')
      }
      setSigned(true)
      setStep('view')
    } catch (err) {
      setOtpError((err as Error).message)
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
          <div className="text-4xl mb-4">&#128279;</div>
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

        {/* Bloc signature avec OTP */}
        {!signed && (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            {/* Étape 1 : Bouton initial */}
            {step === 'view' && (
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  Pour accepter ce devis, une vérification par SMS sera effectuée.
                </p>
                <button
                  onClick={handleSendCode}
                  disabled={sending}
                  className="bg-black text-white px-8 py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors text-lg w-full sm:w-auto disabled:opacity-50"
                >
                  {sending ? 'Envoi en cours...' : 'Accepter et signer ce devis'}
                </button>
              </div>
            )}

            {/* Étape 2 : Saisie du code OTP */}
            {step === 'enter_code' && (
              <div className="max-w-sm mx-auto text-center">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                  <p className="text-blue-800 text-sm font-medium">
                    Un code de vérification a été envoyé au {phoneMasked}
                  </p>
                </div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Entrez le code reçu par SMS
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center text-2xl tracking-[0.5em] font-mono border-2 border-gray-300 rounded-xl py-3 px-4 focus:border-black focus:outline-none mb-4"
                  placeholder="------"
                  autoFocus
                />
                <button
                  onClick={handleVerifyCode}
                  disabled={code.length !== 6 || sending}
                  className="w-full bg-black text-white py-3 rounded-xl font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors mb-3"
                >
                  {sending ? 'Vérification...' : 'Vérifier le code'}
                </button>
                <button
                  onClick={handleSendCode}
                  disabled={sending}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Renvoyer le code
                </button>
              </div>
            )}

            {/* Étape 3 : Consentement + Signature + Slide */}
            {step === 'sign' && (
              <div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 text-center">
                  <p className="text-green-700 text-sm font-medium">&#10003; Identité vérifiée par SMS</p>
                </div>

                {/* Consentement */}
                <label className="flex items-start gap-3 mb-5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-black focus:ring-black"
                  />
                  <span className="text-sm text-gray-700 leading-snug">
                    <strong>Lu et approuvé, bon pour accord.</strong> J&apos;accepte les conditions,
                    les tarifs et les délais indiqués dans ce devis pour un montant total TTC
                    de {devis.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}.
                  </span>
                </label>

                {/* Signature */}
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

                <div className="flex justify-between items-center mb-5">
                  <button
                    onClick={() => sigCanvas.current?.clear()}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    Effacer la signature
                  </button>
                  <button
                    onClick={() => { setStep('view'); setCode(''); setConsent(false); setSlideConfirmed(false) }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Annuler
                  </button>
                </div>

                {/* Slide to confirm */}
                {consent && !slideConfirmed ? (
                  <SlideToConfirm
                    label="Glissez pour signer le devis"
                    disabled={submitting}
                    onConfirm={() => {
                      setSlideConfirmed(true)
                      handleSign()
                    }}
                  />
                ) : !consent ? (
                  <div className="h-14 rounded-xl bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-400 text-sm">Cochez la case ci-dessus pour signer</span>
                  </div>
                ) : (
                  <div className="h-14 rounded-xl bg-green-600 flex items-center justify-center">
                    <span className="text-white font-semibold">
                      {submitting ? 'Enregistrement...' : '&#10003; Signature validée'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Erreur */}
            {otpError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <p className="text-red-700 text-sm">{otpError}</p>
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
