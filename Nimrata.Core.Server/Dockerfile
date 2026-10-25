# Сборка всего приложения одним образом: клиент (Vite) + сервер (ASP.NET Core).
# Контекст сборки — корень репозитория: docker build -f Nimrata.Core.Server/Dockerfile .

# Стадия 0: базовый рабочий образ. Должна идти первой и называться base: IDE (Rider/VS) в режиме отладки собирает образ только до неё.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

# Стадия 1: собираем клиент.
FROM node:22-alpine AS client
WORKDIR /src/nimrata.core.client
COPY nimrata.core.client/package.json nimrata.core.client/package-lock.json ./
RUN npm ci
COPY nimrata.core.client/ ./
RUN npm run build

# Стадия 2: публикуем сервер; готовый dist подкладывается в wwwroot (SkipClientBuild отключает node-сборку в MSBuild).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
WORKDIR /src
COPY Nimrata.Core.Server/Nimrata.Core.Server.csproj Nimrata.Core.Server/
RUN dotnet restore Nimrata.Core.Server/Nimrata.Core.Server.csproj -p:SkipClientBuild=true
COPY Nimrata.Core.Server/ Nimrata.Core.Server/
COPY --from=client /src/nimrata.core.client/dist nimrata.core.client/dist
# Манифесты модулей читаются сервером (Content в csproj ссылается на src/modules/*/manifest.json клиентской части).
COPY nimrata.core.client/src/modules/ nimrata.core.client/src/modules/
RUN dotnet publish Nimrata.Core.Server/Nimrata.Core.Server.csproj -c Release -o /app/publish \
    -p:SkipClientBuild=true -p:UseAppHost=false --no-restore

# Стадия 3: рабочий образ.
FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Nimrata.Core.Server.dll"]
