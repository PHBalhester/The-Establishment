"use client";

import { useEffect, useRef } from "react";

export function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Ensure video plays on mount
    if (videoRef.current) {
      videoRef.current.play().catch((error) => {
        console.log("[v0] Autoplay prevented:", error);
      });
    }
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Video element com placeholder */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover blur-sm opacity-30"
        poster="/videos/politician-bribe-placeholder.jpg"
      >
        {/* Adicione seu vídeo real aqui */}
        <source src="/videos/politician-bribe.mp4" type="video/mp4" />
        <source src="/videos/politician-bribe.webm" type="video/webm" />
        
        {/* Fallback: imagem estática se o vídeo não carregar */}
        <div
          className="absolute inset-0 w-full h-full bg-cover bg-center"
          style={{ backgroundImage: "url('/videos/politician-bribe-placeholder.jpg')" }}
        />
      </video>

      {/* Overlay de blur e opacidade adicional */}
      <div className="absolute inset-0 bg-government-bg/70 backdrop-blur-sm" />
      
      {/* Gradiente para escurecer as bordas */}
      <div className="absolute inset-0 bg-gradient-to-b from-government-bg/90 via-government-bg/60 to-government-bg/95" />
    </div>
  );
}
