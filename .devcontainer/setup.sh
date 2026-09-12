echo "🚀 Configurando ambiente Node.js..."

cd services || exit

for d in */ ; do
  echo "📦 Instalando pacotes em $d"
  cd "$d" || exit
  
  npm install

  if [ ! -f .env ]; then
    cp .env.example .env

    sed -i 's/localhost/host.docker.internal/g' .env
    sed -i 's/127.0.0.1/host.docker.internal/g' .env
  fi
  
  cd ..
done

echo "✅ Ambiente pronto! Lembre-se de rodar o docker-compose up na sua máquina local."