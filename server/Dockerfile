# Use a lightweight Node.js image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the server code
COPY . .

# Expose the port the server will run on (Fly defaults to 8080)
EXPOSE 8080

# Command to run your server
CMD ["node", "index.js"]