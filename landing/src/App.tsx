import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Lenis from 'lenis'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { WhySubspaceMail } from './components/WhySubspaceMail'
import { ProductShowcase } from './components/ProductShowcase'
import { Features } from './components/Features'
import { OpenSource } from './components/OpenSource'
import { CtaFooter } from './components/CtaFooter'
import { Privacy } from './pages/Privacy'
import { Terms } from './pages/Terms'
import './App.css'

function HomePage() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    })

    function raf(time: number) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)

    return () => lenis.destroy()
  }, [])

  return (
    <div className="relative min-h-screen">
      <Navbar />
      <main>
        <Hero />
        <WhySubspaceMail />
        <ProductShowcase />
        <Features />
        <OpenSource />
        <CtaFooter />
      </main>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
    </Routes>
  )
}

export default App
