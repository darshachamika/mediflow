cmake_minimum_required(VERSION 3.16)
project(MediFlowQueueSimulator LANGUAGES CXX)

add_executable(queue-simulator main.cpp)
target_compile_features(queue-simulator PRIVATE cxx_std_17)

enable_testing()
add_test(NAME deterministic-waits COMMAND queue-simulator --self-test)
