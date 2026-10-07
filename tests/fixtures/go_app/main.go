package main

import "net/http"

func health(w http.ResponseWriter, r *http.Request) {}

func createWidget(w http.ResponseWriter, r *http.Request) {}

func legacy(w http.ResponseWriter, r *http.Request) {}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("POST /widgets", createWidget)
	http.HandleFunc("/legacy", legacy)
	http.ListenAndServe(":8080", mux)
}
