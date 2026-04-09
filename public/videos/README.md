# Background Video

Este diretório contém o vídeo de background para a homepage de The Establishment.

## Vídeo Atual

O vídeo deve mostrar um político recebendo suborno e fugindo, em loop contínuo.

### Especificações Técnicas

- **Formato**: MP4 (H.264) e WebM para compatibilidade
- **Resolução**: 1920x1080 (Full HD) ou maior
- **Duração**: 10-30 segundos (para loop suave)
- **Taxa de quadros**: 24-30 fps
- **Estilo**: Noir/cinema, com motion blur, estética de câmera de segurança
- **Cores**: Azul escuro (navy), dourado, tons sombrios

### Arquivos Necessários

Adicione os seguintes arquivos neste diretório:

```
/public/videos/
  ├── politician-bribe.mp4          # Vídeo principal (H.264)
  ├── politician-bribe.webm         # Alternativa WebM
  └── politician-bribe-placeholder.jpg  # ✓ Já existe (poster/fallback)
```

### Como o Vídeo é Usado

O componente `BackgroundVideo` (`app/components/home/BackgroundVideo.tsx`) renderiza o vídeo com:
- **Loop**: Reproduz continuamente
- **Autoplay**: Inicia automaticamente (muted para permitir autoplay)
- **Blur**: Aplicado via CSS (`blur-sm`)
- **Opacidade**: Reduzida para 30% + overlay escuro
- **Fallback**: Se o vídeo não carregar, mostra a imagem placeholder

### Criando o Vídeo

Você pode criar o vídeo usando:
1. **IA generativa**: Runway ML, Pika Labs, ou Stable Video Diffusion
2. **Stock footage**: Sites como Pexels, Pixabay (buscar "politician corruption", "bribery", "running away")
3. **Edição de vídeo**: Compilar clips com efeitos de blur, grainy filter, e motion blur

### Otimização

Para melhor performance:
```bash
# Comprimir MP4
ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 28 -c:a aac -b:a 128k politician-bribe.mp4

# Criar WebM
ffmpeg -i input.mp4 -c:v libvpx-vp9 -crf 30 -b:v 0 politician-bribe.webm
```

### Preview

Atualmente usando imagem placeholder que mostra o conceito visual esperado.
